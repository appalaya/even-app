// Scores the on-device category model against the labelled titles in packages/core/src/categories.eval.json
// (design.md "Model refinement") and prints accuracy per category, the misses, and latency.
//
// It compiles together with the module's own classifier, so it scores exactly the prompt, schema and timeout the
// app ships. From the repo root, on a Mac with Apple Intelligence turned on (macOS 26 or later):
//
//   npm run eval:categories
//
// which runs
//
//   xcrun swiftc -parse-as-library -O modules/even-classifier/ios/ExpenseClassifier.swift \
//     scripts/eval-categories.swift -o "${TMPDIR:-/tmp}/eval-categories" && "${TMPDIR:-/tmp}/eval-categories"
//
// Optional argument: the eval file's path (default packages/core/src/categories.eval.json).
// Titles stay on the Mac: the classifier uses the on-device system model only.
//
// The iOS simulator can run the same binary (build with `xcrun --sdk iphonesimulator swiftc -target
// arm64-apple-ios27.0-simulator ...`, then `xcrun simctl spawn booted <binary> <absolute path to the eval file>`),
// but it answers with the Mac's model, so it needs Apple Intelligence on the Mac too and scores the same. A phone
// may run a smaller variant of the model: its accuracy is checked on the phone, typing the titles into Add expense.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct EvalFile: Decodable {
  struct Case: Decodable {
    let title: String
    let category: String
  }
  let cases: [Case]
}

@main
struct EvalCategories {
  static func main() async {
    let path = CommandLine.arguments.dropFirst().first ?? "packages/core/src/categories.eval.json"
    let file: EvalFile
    do {
      file = try JSONDecoder().decode(EvalFile.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    } catch {
      print("Could not read \(path): \(error)")
      exit(2)
    }

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
    // As the app does when Add expense opens, so the first case is not a cold start.
    ExpenseClassifier.prewarm()
    try? await Task.sleep(for: .seconds(1))
    print("Cases: \(file.cases.count), timeout \(ExpenseClassifier.timeout), prewarmed\n")

    var order: [String] = []
    var right: [String: Int] = [:]
    var total: [String: Int] = [:]
    var misses: [String] = []
    var noAnswer = 0
    var latencies: [Double] = []
    let clock = ContinuousClock()

    for item in file.cases {
      if total[item.category] == nil { order.append(item.category) }
      total[item.category, default: 0] += 1
      let start = clock.now
      let answer = await ExpenseClassifier.classify(item.title)
      let elapsed = start.duration(to: clock.now)
      latencies.append(Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15)
      if answer == item.category {
        right[item.category, default: 0] += 1
      } else {
        if answer == nil { noAnswer += 1 }
        misses.append("  \(item.title)  →  \(answer ?? "no answer")  (labelled \(item.category))")
      }
    }

    func percent(_ a: Int, _ b: Int) -> String { b == 0 ? "-" : String(format: "%3.0f%%", 100 * Double(a) / Double(b)) }

    print("Per category")
    for category in order {
      let r = right[category, default: 0]
      let t = total[category, default: 0]
      print("  \(category.padding(toLength: 12, withPad: " ", startingAt: 0)) \(r)/\(t)  \(percent(r, t))")
    }
    let allRight = right.values.reduce(0, +)
    print("\nOverall \(allRight)/\(file.cases.count)  \(percent(allRight, file.cases.count))")
    print("No answer (timeout, refusal or error): \(noAnswer)")

    let sorted = latencies.sorted()
    func at(_ q: Double) -> String {
      sorted.isEmpty ? "-" : String(format: "%.0f ms", sorted[min(sorted.count - 1, Int(Double(sorted.count) * q))])
    }
    print("Latency p50 \(at(0.5)), p95 \(at(0.95)), max \(at(1.0))")

    if !misses.isEmpty {
      print("\nMisses")
      for line in misses { print(line) }
    }
  }
}
