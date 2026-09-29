// Scores ways of naming an expense's category against the labelled titles in packages/core/src/categories.eval.json
// (design.md "Model refinement"): the keyword table alone, the model alone, and the ways of combining them. For each
// strategy it prints accuracy on the train and held-out splits, the chips that visibly swap after the pause (and how
// many of those undo a chip that was right), latency, and the confusion of the misses.
//
// It compiles together with the module's own classifier, so the `shipped` asker scores exactly the prompt, schema
// and timeout the app ships; scripts/eval-categories-strategies.swift holds the experimental askers. From the repo
// root, on a Mac with Apple Intelligence turned on (macOS 27):
//
//   npm run eval:categories                          # the shipped strategy (default): history first, then
//                                                    # the keyword table, then the model for titles neither knows
//                                                    # or whose keywords name two categories (gate c)
//   npm run eval:categories -- --strategy all        # every strategy
//   npm run eval:categories -- --strategy b-fallback,c-hint --misses all
//   npm run eval:categories -- --strategy gate-a,gate-b,gate-c,gate-d   # when the model is asked (design.md)
//   npm run eval:categories -- --strategy all-general,p-build120,p-lines,p-minimal,p-minimal-b --added 30
//                                                    # the prompt variants for the smaller model (design.md)
//   npm run eval:categories -- --refusals            # the titles guardrails might refuse, per model arrangement
//   npm run eval:categories -- --first-request cold  # one fresh process's first request (or `prewarmed`)
//
// which first runs scripts/eval-categories-keywords.mjs (the keyword table's guess for each title, from
// packages/core) and then this script with `--cases <that file>`.
//
// Flags:
//   --cases <path>        the eval file with keyword guesses (the npm script passes it)
//   --strategy <names>    comma-separated strategy names, or `all`; `--list` prints them. A name ending in `+g`
//                         puts history first: a title recalled from earlier ones (leave one out) takes that
//                         category at once and the model is not asked
//   --split train|heldout|all
//                         score only that split (tune prompts with `--split train`, so held-out stays unseen)
//   --misses train|heldout|added|all|none
//                         whose misses to list (default train: look at held-out misses only for the final report)
//   --added <n>           also score the file's last n titles on their own (a batch added to the held-out split)
//   --refusals            ask each model arrangement about packages/core/src/categories.refusals.json and count
//                         what comes back: answered, other, refused (guardrail or refusal), error, timeout; with
//                         `--arrangements a,b` for a subset (default: every arrangement)
//   --first-request cold|prewarmed
//                         time this process's first request (for `--title`, default "Hazy IPA"), either cold or after
//                         `ExpenseClassifier.prewarm()` and `--wait-ms` (default 1500), as Add expense does; run it
//                         in a loop for a distribution
//
// Titles stay on the Mac: every asker uses the on-device system model only.
//
// The iOS simulator answers with the Mac's model, so it scores the same. A phone may run a smaller variant of the
// model ("AFM 3 Core" rather than the Mac's "Core Advanced"): its accuracy is checked on the phone.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct EvalCase: Decodable, Sendable {
  let title: String
  let category: String
  let split: String
  /// The keyword table's guess (`inferCategory`); "other" means the table found nothing.
  let keyword: String
  /// History first (`recallCategory`), as if every other title had been saved earlier with its label; nil: no match.
  let history: String?
  /// How many words the table reads (`titleWords`), and the keywords it finds as [keyword, category], leaving out one
  /// inside a longer match (`keywordMatches`).
  var words: Int? = nil
  var matches: [[String]]? = nil
}

/// A title from packages/core/src/categories.refusals.json.
struct RefusalCase: Decodable, Sendable {
  let title: String
  /// The chip a person would expect; nil when no one category is.
  let category: String?
  let kind: String
  let keyword: String
  /// Also in the eval set, with this label.
  let labelled: Bool
}

struct CasesFile: Decodable {
  let cases: [EvalCase]
  var refusals: [RefusalCase]? = nil
}

/// How the keyword guess and a model answer combine into the chip after the pause.
enum Gate {
  /// The model's answer replaces the keyword guess (what shipped first).
  case always
  /// The model is asked only when the table found nothing.
  case fallback
  /// The model is always asked, with the table's guess as a hint when it matched.
  case hint
  /// The model is always asked for an answer and a confidence; it replaces a keyword match only at high confidence.
  case confident
  /// (b) As `fallback`, and also when the title has 3+ words and the table matched a single keyword in it.
  case fallbackLong
  /// (c) As `fallback`, and also when the table matched keywords of two different categories.
  case fallbackConflict
  /// (d) `fallbackLong` or `fallbackConflict`.
  case fallbackEither
  /// (b′) As `fallback`, and also when the title has 3+ words and the table matched a single one-word keyword.
  case fallbackLongWord
  /// (d′) `fallbackLongWord` or `fallbackConflict`.
  case fallbackEitherWord
}

/// Whether `gate` asks the model about `c` (history aside): what `shouldAskModel` decides in the app for gate (a),
/// and its variants.
func asksModel(_ gate: Gate, _ c: EvalCase) -> Bool {
  let none = c.keyword == "other"
  let matches = c.matches ?? []
  let long = (c.words ?? 0) >= 3 && matches.count == 1
  let longWord = long && !(matches.first?.first ?? " ").contains(" ")
  let conflict = Set(matches.map { $0.count > 1 ? $0[1] : "" }).count >= 2
  switch gate {
  case .always, .hint, .confident: return true
  case .fallback: return none
  case .fallbackLong: return none || long
  case .fallbackConflict: return none || conflict
  case .fallbackEither: return none || long || conflict
  case .fallbackLongWord: return none || longWord
  case .fallbackEitherWord: return none || longWord || conflict
  }
}

struct Strategy {
  let name: String
  let summary: String
  let asker: String?
  let gate: Gate
  /// History first: a recalled category is the chip at once, and the model is not asked.
  var history = false
  /// The model's `other` is no answer and the local guess stands, as `refineCategory` does in the app.
  var otherIsNoAnswer = false
}

let strategies: [Strategy] = [
  Strategy(name: "table", summary: "keyword table only", asker: nil, gate: .fallback),
  Strategy(name: "shipped", summary: "what the app ships: history, then the table, then the model for the rest and "
             + "for keywords of two categories (gate c); the model's other is no answer",
           asker: "shipped", gate: .fallbackConflict, history: true, otherIsNoAnswer: true),
  Strategy(name: "gate-a", summary: "gate (a): ask only when history and the table find nothing", asker: "shipped",
           gate: .fallback, history: true, otherIsNoAnswer: true),
  Strategy(name: "gate-b", summary: "gate (b): also when 3+ words and a single keyword", asker: "shipped",
           gate: .fallbackLong, history: true, otherIsNoAnswer: true),
  Strategy(name: "gate-c", summary: "gate (c): also when keywords of two categories match", asker: "shipped",
           gate: .fallbackConflict, history: true, otherIsNoAnswer: true),
  Strategy(name: "gate-d", summary: "gate (d): (b) or (c)", asker: "shipped", gate: .fallbackEither, history: true,
           otherIsNoAnswer: true),
  Strategy(name: "gate-b1", summary: "gate (b′): also when 3+ words and a single one-word keyword",
           asker: "shipped", gate: .fallbackLongWord, history: true, otherIsNoAnswer: true),
  Strategy(name: "gate-d1", summary: "gate (d′): (b′) or (c)", asker: "shipped", gate: .fallbackEitherWord,
           history: true, otherIsNoAnswer: true),
  Strategy(name: "arr-general", summary: "shipped path, the general model only", asker: "general",
           gate: .fallback, history: true, otherIsNoAnswer: true),
  Strategy(name: "arr-tagging", summary: "shipped path, the content-tagging model only", asker: "contentTagging",
           gate: .fallback, history: true, otherIsNoAnswer: true),
  Strategy(name: "arr-general+retry", summary: "shipped path, general, content tagging after a refusal or error",
           asker: "general+retry", gate: .fallback, history: true, otherIsNoAnswer: true),
  Strategy(name: "arr-tagging+retry", summary: "shipped path, content tagging, general after a refusal or error",
           asker: "contentTagging+retry", gate: .fallback, history: true, otherIsNoAnswer: true),
  Strategy(name: "all-general", summary: "the general model (module's classify) on every title", asker: "general",
           gate: .always),
  Strategy(name: "all-general-prewarmed", summary: "the general model on every title, each on a prewarmed session",
           asker: "general-prewarmed", gate: .always),
  Strategy(name: "all-tagging", summary: "the content-tagging model (module's classify) on every title",
           asker: "contentTagging", gate: .always),
  Strategy(name: "a-model", summary: "(a) model always, original prompt", asker: "base", gate: .always),
  Strategy(name: "b-fallback", summary: "(b) model only when the table finds nothing", asker: "base", gate: .fallback),
  Strategy(name: "c-hint", summary: "(c) table's guess as a hint, model decides", asker: "base+hint", gate: .hint),
  Strategy(name: "d-confidence", summary: "(d) override a keyword hit only at high confidence", asker: "base+conf",
           gate: .confident),
  Strategy(name: "d-reason", summary: "(d) short reason + confidence; override only at high", asker: "base+reason",
           gate: .confident),
  Strategy(name: "d-vote", summary: "(d) 3 samples; override a keyword hit only at 3/3", asker: "vote",
           gate: .confident),
  Strategy(name: "e-twostep", summary: "(e) merchant kind, mapped; direct answer for service/other",
           asker: "twostep", gate: .always),
  Strategy(name: "e-kindfirst", summary: "(e) one answer: kind then category", asker: "kindfirst", gate: .always),
  Strategy(name: "e-twostep-fallback", summary: "(e) two-step, only when the table finds nothing", asker: "twostep",
           gate: .fallback),
  Strategy(name: "tagging", summary: "content-tagging model, always", asker: "tagging", gate: .always),
  Strategy(name: "f-tuned", summary: "(f) the shipped prompt (tuned on train), always", asker: "tuned",
           gate: .always),
  Strategy(name: "f-tuned-fallback", summary: "(f) the shipped prompt, only when the table finds nothing",
           asker: "tuned", gate: .fallback),
  Strategy(name: "f-tuned-hint", summary: "(f)+(c) the shipped prompt with the table's hint", asker: "tuned+hint",
           gate: .hint),
  Strategy(name: "p-build120", summary: "the prompt shipped to build 120, on every title", asker: "build120",
           gate: .always),
  Strategy(name: "p-minimal", summary: "the minimal prompt (three words per category), on every title",
           asker: "minimal", gate: .always),
  Strategy(name: "p-minimal-b", summary: "the minimal prompt and the boundary sentences, on every title",
           asker: "minimal+boundaries", gate: .always),
  Strategy(name: "p-lines", summary: "the shipped prompt without its boundary sentences, on every title",
           asker: "lines", gate: .always),
  Strategy(name: "shipped-build120", summary: "the shipped path with the build 120 prompt", asker: "build120",
           gate: .fallbackConflict, history: true, otherIsNoAnswer: true),
  Strategy(name: "f-fewshot", summary: "(f) few-shot prompt, always", asker: "fewshot", gate: .always),
  Strategy(name: "f-fewshot-fallback", summary: "(f) few-shot, only when the table finds nothing", asker: "fewshot",
           gate: .fallback),
  Strategy(name: "f-fewshot-hint", summary: "(f)+(c) few-shot with the table's hint", asker: "fewshot+hint",
           gate: .hint),
  Strategy(name: "f-fewshot-confidence", summary: "(f)+(d) few-shot, override only at high confidence",
           asker: "fewshot+conf", gate: .confident),
]

struct Record {
  let answer: Answer?
  let ms: Double
}

struct Options {
  var cases = "packages/core/src/categories.eval.json"
  var strategies = ["shipped"]
  var misses = "train"
  var split = "all"
  var added = 0
  var refusals = false
  var arrangements: [String]? = nil
  var firstRequest: String? = nil
  var title = "Hazy IPA"
  var waitMs = 1500
}

func parseArguments() -> Options {
  var o = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--cases": o.cases = args.next() ?? o.cases
    case "--strategy", "--strategies":
      o.strategies = (args.next() ?? "shipped").split(separator: ",").map(String.init)
    case "--misses": o.misses = args.next() ?? o.misses
    case "--split": o.split = args.next() ?? o.split
    case "--added": o.added = Int(args.next() ?? "") ?? 0
    case "--refusals": o.refusals = true
    case "--arrangements": o.arrangements = (args.next() ?? "").split(separator: ",").map(String.init)
    case "--first-request": o.firstRequest = args.next() ?? "cold"
    case "--title": o.title = args.next() ?? o.title
    case "--wait-ms": o.waitMs = Int(args.next() ?? "") ?? o.waitMs
    case "--list":
      for s in strategies { print("\(s.name.padding(toLength: 22, withPad: " ", startingAt: 0)) \(s.summary)") }
      exit(0)
    default:
      print("Unknown argument \(arg). Flags: --cases <path> --strategy <names|all> --split train|heldout|all --misses train|heldout|added|all|none --added <n> --refusals [--arrangements a,b] --first-request cold|prewarmed [--title t] [--wait-ms n] --list")
      exit(2)
    }
  }
  if o.strategies == ["all"] { o.strategies = strategies.map(\.name) }
  return o
}

func milliseconds(_ d: Duration) -> Double {
  Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
}

func percent(_ a: Int, _ b: Int) -> String {
  b == 0 ? "   -" : String(format: "%3.0f%%", 100 * Double(a) / Double(b))
}

func quantile(_ values: [Double], _ q: Double) -> String {
  let sorted = values.sorted()
  if sorted.isEmpty { return "-" }
  return String(format: "%.0f", sorted[min(sorted.count - 1, Int(Double(sorted.count) * q))])
}

func pad(_ s: String, _ n: Int) -> String { s.padding(toLength: max(n, s.count), withPad: " ", startingAt: 0) }

@main
struct EvalCategories {
  static func main() async {
    let options = parseArguments()
    if let mode = options.firstRequest {
      await firstRequest(mode, title: options.title, waitMs: options.waitMs)
      return
    }
    var file: CasesFile
    var added: Set<String> = []
    do {
      file = try JSONDecoder().decode(CasesFile.self, from: Data(contentsOf: URL(fileURLWithPath: options.cases)))
      added = Set(file.cases.suffix(options.added).map(\.title))
      if options.split != "all" { file = CasesFile(cases: file.cases.filter { $0.split == options.split }) }
    } catch {
      print("Could not read \(options.cases): \(error)")
      print("Run it through `npm run eval:categories`, which adds the keyword guesses first.")
      exit(2)
    }
    let chosen = options.strategies.compactMap { name -> Strategy? in
      let base = name.hasSuffix("+g") ? String(name.dropLast(2)) : name
      guard var s = strategies.first(where: { $0.name == base }) else {
        print("Unknown strategy \(name) (see --list)")
        return nil
      }
      if base != name {
        s = Strategy(name: name, summary: "(g) history first, then " + s.summary, asker: s.asker, gate: s.gate,
                     history: true)
      }
      return s
    }
    if chosen.isEmpty { exit(2) }

    let needsModel = options.refusals || chosen.contains { $0.asker != nil }
    if needsModel {
      let availability = ExpenseClassifier.availability()
      guard availability == .available else {
        print("The on-device model is unavailable here: \(availability).")
        print("Turn on Apple Intelligence (System Settings) and wait for the model to download, or run the cases on a phone.")
        exit(3)
      }
      printModels()
    }
    if options.refusals {
      await scoreRefusals(file.refusals ?? [], arrangements: options.arrangements)
      return
    }
    let train = file.cases.filter { $0.split == "train" }.count
    let heldout = file.cases.filter { $0.split == "heldout" }.count
    let addedNote = added.isEmpty ? "" : ", the last \(added.count) also scored as added"
    print("Cases: \(file.cases.count) (train \(train), held-out \(heldout)\(addedNote)),"
      + " timeout \(ExpenseClassifier.timeout)\n")

    // Ask each asker once per (title, hint) it is needed for.
    let askers = Dictionary(uniqueKeysWithValues: allAskers().map { ($0.name, $0) })
    var records: [String: [String: Record]] = [:]  // asker → key → record
    func key(_ c: EvalCase, _ hint: String?) -> String { "\(c.title)\u{0}\(hint ?? "")" }
    let clock = ContinuousClock()
    for strategy in chosen {
      guard let name = strategy.asker, let asker = askers[name] else { continue }
      var pending: [(EvalCase, String?)] = []
      for c in file.cases {
        if !asksModel(strategy.gate, c) { continue }
        if strategy.history && c.history != nil { continue }
        let hint = asker.usesHint && c.keyword != "other" ? c.keyword : nil
        if records[name]?[key(c, hint)] == nil { pending.append((c, hint)) }
      }
      if pending.isEmpty { continue }
      prewarm(asker: name)
      try? await Task.sleep(for: .seconds(1))
      FileHandle.standardError.write("asking \(name) about \(pending.count) titles…\n".data(using: .utf8)!)
      for (c, hint) in pending {
        let start = clock.now
        let answer = await asker.ask(c.title, hint)
        records[name, default: [:]][key(c, hint)] = Record(answer: answer, ms: milliseconds(start.duration(to: clock.now)))
      }
    }

    struct Row {
      var right: [String: Int] = [:]
      var total: [String: Int] = [:]
      var swaps = 0, undo = 0, fix = 0, calls = 0, noAnswer = 0, agree = 0
      var outcomes: [String: Int] = [:]
      var latencies: [Double] = []
      var misses: [(EvalCase, String, Answer?)] = []
      var undone: [(EvalCase, String)] = []
    }
    var rows: [(Strategy, Row)] = []
    for strategy in chosen {
      var row = Row()
      for c in file.cases {
        row.total[c.split, default: 0] += 1
        let isAdded = added.contains(c.title)
        if isAdded { row.total["added", default: 0] += 1 }
        let matched = c.keyword != "other"
        let recalled = strategy.history ? c.history : nil
        // What the chip shows as you type: the recalled category, else the keyword guess.
        let instant = recalled ?? c.keyword
        var final = instant
        var answer: Answer? = nil
        if let name = strategy.asker, recalled == nil, asksModel(strategy.gate, c) {
          let hint = (askers[name]?.usesHint ?? false) && matched ? c.keyword : nil
          let record = records[name]?[key(c, hint)]
          row.calls += 1
          if let ms = record?.ms { row.latencies.append(ms) }
          answer = record?.answer ?? nil
          if let outcome = answer?.outcome { row.outcomes[outcome, default: 0] += 1 }
          // The model agreeing with a chip that is not Other makes it the model's pick: the sparkle, no swap.
          if matched || recalled != nil, answer?.category == instant { row.agree += 1 }
          if let category = answer?.category, !(strategy.otherIsNoAnswer && category == "other") {
            if strategy.gate == .confident && matched {
              if answer?.confidence == "high" { final = category }
            } else {
              final = category
            }
          } else {
            row.noAnswer += 1
          }
        }
        if final == c.category {
          row.right[c.split, default: 0] += 1
          if isAdded { row.right["added", default: 0] += 1 }
        } else {
          row.misses.append((c, final, answer))
        }
        if final != instant {
          row.swaps += 1
          if instant == c.category { row.undo += 1; row.undone.append((c, final)) }
          if final == c.category { row.fix += 1 }
        }
      }
      rows.append((strategy, row))
    }

    let addedHeader = added.isEmpty ? "" : " \(pad("added", 12))"
    print("""
      \(pad("strategy", 22)) \(pad("train", 12)) \(pad("held-out", 12))\(addedHeader) \(pad("all", 12)) swaps  undo  fix  agree  calls  p50 ms  p95 ms
      """)
    for (strategy, row) in rows {
      func cell(_ split: String?) -> String {
        // `nil` is every title: the train and held-out splits (the added titles are already in held-out).
        func both(_ counts: [String: Int]) -> Int { counts["train", default: 0] + counts["heldout", default: 0] }
        let r = split.map { row.right[$0, default: 0] } ?? both(row.right)
        let t = split.map { row.total[$0, default: 0] } ?? both(row.total)
        return pad("\(r)/\(t) \(percent(r, t))", 12)
      }
      let addedCell = added.isEmpty ? "" : " \(cell("added"))"
      print(
        "\(pad(strategy.name, 22)) \(cell("train")) \(cell("heldout"))\(addedCell) \(cell(nil))"
          + " \(pad(String(row.swaps), 6))"
          + " \(pad(String(row.undo), 5)) \(pad(String(row.fix), 4)) \(pad(String(row.agree), 6))"
          + " \(pad(String(row.calls), 6))"
          + " \(pad(quantile(row.latencies, 0.5), 7)) \(quantile(row.latencies, 0.95))")
    }
    print("""

      swaps: chips that change after the pause (what showed as you typed → final); undo: swaps away from a right chip
      (the cost you see); fix: swaps to the right answer; agree: a keyword or history chip the model agreed with, which
      gains the sparkle with no swap. calls: model requests; latency is per request, prewarmed. added: the file's last
      titles (`--added`), already counted in their split.
      """)

    for (strategy, row) in rows {
      func listed(_ c: EvalCase) -> Bool {
        options.misses == "all" || c.split == options.misses || (options.misses == "added" && added.contains(c.title))
      }
      let shown = row.misses.filter { listed($0.0) }
      if options.misses == "none" { break }
      print("\n\(strategy.name): \(strategy.summary)")
      if row.noAnswer > 0 {
        let why = row.outcomes.filter { $0.key != "answered" }.sorted { $0.key < $1.key }
          .map { "\($0.key) \($0.value)" }.joined(separator: ", ")
        print("  no answer: \(row.noAnswer)" + (why.isEmpty ? " (other, timeout, refusal or error)" : " (\(why))"))
      }
      var confusion: [String: Int] = [:]
      for (c, final, _) in shown { confusion["\(c.category) → \(final)", default: 0] += 1 }
      if !confusion.isEmpty {
        let pairs = confusion.sorted { $0.value > $1.value || ($0.value == $1.value && $0.key < $1.key) }
        print("  confusion (\(options.misses)): " + pairs.map { "\($0.key) ×\($0.value)" }.joined(separator: ", "))
      }
      for (c, final, answer) in shown {
        var extra: [String] = []
        if c.keyword != "other" { extra.append("table \(c.keyword)") }
        if strategy.history, let h = c.history { extra.append("history \(h)") }
        if let kind = answer?.kind { extra.append("kind \(kind)") }
        if let confidence = answer?.confidence { extra.append(confidence) }
        if let reason = answer?.reason { extra.append("“\(reason)”") }
        if answer != nil && answer?.category != final { extra.append("model \(answer?.category ?? "no answer")") }
        let suffix = extra.isEmpty ? "" : "  [\(extra.joined(separator: ", "))]"
        print("  \(c.split == "heldout" ? "H" : "T") \(c.title)  →  \(final)  (labelled \(c.category))\(suffix)")
      }
      let undone = row.undone.filter { listed($0.0) }
      if !undone.isEmpty {
        print("  undid a right keyword chip: " + undone.map { "\($0.0.title) → \($0.1)" }.joined(separator: "; "))
      }
    }
  }
}

/// The model variants this Mac runs, and the arrangement the module ships.
func printModels() {
  #if canImport(FoundationModels)
  if #available(macOS 27.0, iOS 27.0, *) {
    let general = SystemLanguageModel.default.variant.displayName
    let tagging = SystemLanguageModel(useCase: .contentTagging).variant.displayName
    let shipped = ExpenseClassifier.models.map(\.rawValue).joined(separator: ", then ")
    print("Model: \(general) (general), \(tagging) (content tagging); the module asks \(shipped)")
  }
  #endif
}

/// `--first-request`: this process's first request, cold or after the prewarm Add expense does when it opens.
func firstRequest(_ mode: String, title: String, waitMs: Int) async {
  if mode == "prewarmed" {
    ExpenseClassifier.prewarm()
    try? await Task.sleep(for: .milliseconds(waitMs))
  }
  let result = await ExpenseClassifier.classify(title)
  let attempts = result.attempts.map { "\($0.model.rawValue):\($0.outcome.rawValue):\($0.milliseconds)" }
  print(
    "\(mode) ms=\(result.milliseconds) outcome=\(result.outcome.rawValue) category=\(result.category ?? "-")"
      + " attempts=\(attempts.joined(separator: ","))")
}

/// `--refusals`: every title in the refusal set, asked of each model arrangement directly (no gate), counted by what
/// came back, with accuracy on the labelled titles and on those also in the eval set.
func scoreRefusals(_ titles: [RefusalCase], arrangements names: [String]?) async {
  let order = ["general", "contentTagging", "general+retry", "contentTagging+retry"]
  let chosen = (names ?? order).filter { arrangements[$0] != nil }
  var results: [String: [ExpenseClassification]] = [:]
  for name in chosen {
    let models = arrangements[name] ?? []
    ExpenseClassifier.prewarm(models)
    try? await Task.sleep(for: .seconds(1))
    FileHandle.standardError.write("asking \(name) about \(titles.count) titles…\n".data(using: .utf8)!)
    var list: [ExpenseClassification] = []
    for t in titles { list.append(await ExpenseClassifier.classify(t.title, models: models)) }
    results[name] = list
  }
  let labelled = titles.filter { $0.category != nil }
  let inEval = titles.filter(\.labelled)
  print("Refusal set: \(titles.count) titles, \(labelled.count) labelled, \(inEval.count) also in the eval set;"
    + " timeout \(ExpenseClassifier.timeout)\n")
  print("""
    \(pad("arrangement", 22)) answered  other  refused  error  timeout  retried  right       right (eval)  chip       p50 ms  p95 ms
    """)
  for name in chosen {
    let list = results[name] ?? []
    func count(_ outcome: ExpenseClassifierOutcome) -> Int { list.filter { $0.outcome == outcome }.count }
    var right = 0, rightEval = 0, chip = 0
    for (t, r) in zip(titles, list) {
      guard let label = t.category else { continue }
      if r.category == label { right += 1; if t.labelled { rightEval += 1 } }
      // The chip on the shipped path: a keyword hit stands; otherwise the model's answer, `other` being no answer.
      let shown = t.keyword != "other" ? t.keyword : (r.category.flatMap { $0 == "other" ? nil : $0 } ?? "other")
      if shown == label { chip += 1 }
    }
    let retried = list.filter { $0.attempts.count > 1 }.count
    let latencies = list.map { Double($0.milliseconds) }
    print(
      "\(pad(name, 22)) \(pad(String(count(.answered)), 9)) \(pad(String(count(.other)), 6))"
        + " \(pad(String(count(.refused)), 8)) \(pad(String(count(.error)), 6)) \(pad(String(count(.timeout)), 8))"
        + " \(pad(String(retried), 8)) \(pad("\(right)/\(labelled.count)", 11)) \(pad("\(rightEval)/\(inEval.count)", 13))"
        + " \(pad("\(chip)/\(labelled.count)", 10)) \(pad(quantile(latencies, 0.5), 7)) \(quantile(latencies, 0.95))")
  }
  print("""

    Each title is asked directly, whatever the gate. refused: a guardrail violation or refusal; retried: a second model
    was asked after the first refused or failed. right: the answer equals the label (null labels skipped); right (eval):
    the titles also in the eval set; chip: what the chip shows on the shipped path (the table's hit stands, the model's
    `other` is no answer). Latency is per title, prewarmed, the retry included.

    """)
  let width = max(26, titles.map(\.title.count).max() ?? 0)
  print(pad("title", width) + " " + pad("label", 11) + " " + pad("table", 11) + " "
    + chosen.map { pad($0, 22) }.joined(separator: " "))
  for (i, t) in titles.enumerated() {
    let cells = chosen.map { name -> String in
      guard let r = results[name]?[i] else { return pad("-", 22) }
      let shown: String
      switch r.outcome {
      case .answered, .other: shown = r.category ?? "?"
      default: shown = r.outcome.rawValue.uppercased() + (r.detail.map { " \($0)" } ?? "")
      }
      let mark = t.category == nil ? " " : (r.category == t.category ? " " : "✗")
      let via = r.attempts.count > 1 ? " (retry)" : ""
      return pad("\(mark)\(shown)\(via)", 22)
    }
    let table = t.keyword == "other" ? "-" : t.keyword
    print(pad(t.title, width) + " " + pad(t.category ?? "(none)", 11) + " " + pad(table, 11) + " "
      + cells.joined(separator: " "))
  }
}
