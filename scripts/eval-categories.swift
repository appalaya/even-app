// Scores ways of naming an expense's category against the labelled titles in packages/core/src/categories.eval.json
// (design.md "Model refinement"): the keyword table alone, the model alone, and the ways of combining them. For each
// strategy it prints accuracy on the train and held-out splits, the chips that visibly swap after the pause (and how
// many of those undo a chip that was right), latency, and the confusion of the misses.
//
// It compiles together with the module's own classifier, so the `shipped` asker scores exactly the prompt, schema
// and timeout the app ships; scripts/eval-categories-strategies.swift holds the experimental askers. From the repo
// root, on a Mac with Apple Intelligence turned on (macOS 27):
//
//   npm run eval:categories                          # the shipped strategy (default)
//   npm run eval:categories -- --strategy all        # every strategy
//   npm run eval:categories -- --strategy b-fallback,c-hint --misses all
//
// which first runs scripts/eval-categories-keywords.mjs (the keyword table's guess for each title, from
// packages/core) and then this script with `--cases <that file>`.
//
// Flags:
//   --cases <path>        the eval file with keyword guesses (the npm script passes it)
//   --strategy <names>    comma-separated strategy names, or `all`; `--list` prints them. A name ending in `+g`
//                         puts history first: a title recalled from earlier ones (leave one out) takes that
//                         category at once and the model is not asked
//   --misses train|heldout|all|none
//                         whose misses to list (default train: look at held-out misses only for the final report)
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
}

struct CasesFile: Decodable {
  let cases: [EvalCase]
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
}

struct Strategy {
  let name: String
  let summary: String
  let asker: String?
  let gate: Gate
  /// History first: a recalled category is the chip at once, and the model is not asked.
  var history = false
}

let strategies: [Strategy] = [
  Strategy(name: "table", summary: "keyword table only", asker: nil, gate: .fallback),
  Strategy(name: "shipped", summary: "what the app ships now", asker: "shipped", gate: .always),
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

func parseArguments() -> (cases: String, strategies: [String], misses: String) {
  var cases = "packages/core/src/categories.eval.json"
  var names = ["shipped"]
  var misses = "train"
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--cases": cases = args.next() ?? cases
    case "--strategy", "--strategies": names = (args.next() ?? "shipped").split(separator: ",").map(String.init)
    case "--misses": misses = args.next() ?? misses
    case "--list":
      for s in strategies { print("\(s.name.padding(toLength: 22, withPad: " ", startingAt: 0)) \(s.summary)") }
      exit(0)
    default:
      print("Unknown argument \(arg). Flags: --cases <path> --strategy <names|all> --misses train|heldout|all|none --list")
      exit(2)
    }
  }
  if names == ["all"] { names = strategies.map(\.name) }
  return (cases, names, misses)
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
    let file: CasesFile
    do {
      file = try JSONDecoder().decode(CasesFile.self, from: Data(contentsOf: URL(fileURLWithPath: options.cases)))
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

    let needsModel = chosen.contains { $0.asker != nil }
    if needsModel {
      let availability = ExpenseClassifier.availability()
      guard availability == .available else {
        print("The on-device model is unavailable here: \(availability).")
        print("Turn on Apple Intelligence (System Settings) and wait for the model to download, or run the cases on a phone.")
        exit(3)
      }
      #if canImport(FoundationModels)
      if #available(macOS 27.0, iOS 27.0, *) {
        print("Model: \(SystemLanguageModel.default.variant.displayName)")
      }
      #endif
    }
    let train = file.cases.filter { $0.split == "train" }.count
    let heldout = file.cases.filter { $0.split == "heldout" }.count
    print("Cases: \(file.cases.count) (train \(train), held-out \(heldout)), timeout \(ExpenseClassifier.timeout)\n")

    // Ask each asker once per (title, hint) it is needed for.
    let askers = Dictionary(uniqueKeysWithValues: allAskers().map { ($0.name, $0) })
    var records: [String: [String: Record]] = [:]  // asker → key → record
    func key(_ c: EvalCase, _ hint: String?) -> String { "\(c.title)\u{0}\(hint ?? "")" }
    let clock = ContinuousClock()
    for strategy in chosen {
      guard let name = strategy.asker, let asker = askers[name] else { continue }
      var pending: [(EvalCase, String?)] = []
      for c in file.cases {
        if strategy.gate == .fallback && c.keyword != "other" { continue }
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
      var swaps = 0, undo = 0, fix = 0, calls = 0, noAnswer = 0
      var latencies: [Double] = []
      var misses: [(EvalCase, String, Answer?)] = []
      var undone: [(EvalCase, String)] = []
    }
    var rows: [(Strategy, Row)] = []
    for strategy in chosen {
      var row = Row()
      for c in file.cases {
        row.total[c.split, default: 0] += 1
        let matched = c.keyword != "other"
        let recalled = strategy.history ? c.history : nil
        // What the chip shows as you type: the recalled category, else the keyword guess.
        let instant = recalled ?? c.keyword
        var final = instant
        var answer: Answer? = nil
        if let name = strategy.asker, recalled == nil, !(strategy.gate == .fallback && matched) {
          let hint = (askers[name]?.usesHint ?? false) && matched ? c.keyword : nil
          let record = records[name]?[key(c, hint)]
          row.calls += 1
          if let ms = record?.ms { row.latencies.append(ms) }
          answer = record?.answer ?? nil
          if let category = answer?.category {
            if strategy.gate == .confident && matched {
              if answer?.confidence == "high" { final = category }
            } else {
              final = category
            }
          } else {
            row.noAnswer += 1
          }
        }
        if final == c.category { row.right[c.split, default: 0] += 1 } else { row.misses.append((c, final, answer)) }
        if final != instant {
          row.swaps += 1
          if instant == c.category { row.undo += 1; row.undone.append((c, final)) }
          if final == c.category { row.fix += 1 }
        }
      }
      rows.append((strategy, row))
    }

    print("""
      \(pad("strategy", 22)) \(pad("train", 12)) \(pad("held-out", 12)) \(pad("all", 12)) swaps  undo  fix  calls  p50 ms  p95 ms
      """)
    for (strategy, row) in rows {
      func cell(_ split: String?) -> String {
        let r = split.map { row.right[$0, default: 0] } ?? row.right.values.reduce(0, +)
        let t = split.map { row.total[$0, default: 0] } ?? row.total.values.reduce(0, +)
        return pad("\(r)/\(t) \(percent(r, t))", 12)
      }
      print(
        "\(pad(strategy.name, 22)) \(cell("train")) \(cell("heldout")) \(cell(nil)) \(pad(String(row.swaps), 6))"
          + " \(pad(String(row.undo), 5)) \(pad(String(row.fix), 4)) \(pad(String(row.calls), 6))"
          + " \(pad(quantile(row.latencies, 0.5), 7)) \(quantile(row.latencies, 0.95))")
    }
    print("""

      swaps: chips that change after the pause (what showed as you typed → final); undo: swaps away from a right chip
      (the cost you see); fix: swaps to the right answer. calls: model requests; latency is per request, prewarmed.
      """)

    for (strategy, row) in rows {
      let shown = row.misses.filter { options.misses == "all" || $0.0.split == options.misses }
      if options.misses == "none" { break }
      print("\n\(strategy.name): \(strategy.summary)")
      if row.noAnswer > 0 { print("  no answer (timeout, refusal or error): \(row.noAnswer)") }
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
      let undone = row.undone.filter { options.misses == "all" || $0.0.split == options.misses }
      if !undone.isEmpty {
        print("  undid a right keyword chip: " + undone.map { "\($0.0.title) → \($0.1)" }.joined(separator: "; "))
      }
    }
  }
}
