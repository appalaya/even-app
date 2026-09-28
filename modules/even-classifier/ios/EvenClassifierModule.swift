import ExpoModulesCore

/// `EvenClassifier` for JavaScript (modules/even-classifier/src/EvenClassifierModule.ts). The model work lives in
/// ExpenseClassifier.swift, which has no Expo import so scripts/eval-categories.swift can score the same code.
public class EvenClassifierModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EvenClassifier")

    /// `{ status: 'available' }`, or `{ status: 'unavailable', reason }` with the framework's reason:
    /// deviceNotEligible, appleIntelligenceNotEnabled, modelNotReady (or osTooOld, frameworkMissing).
    AsyncFunction("availability") { () -> [String: String] in
      switch ExpenseClassifier.availability() {
      case .available:
        return ["status": "available"]
      case .unavailable(let reason):
        return ["status": "unavailable", "reason": reason]
      }
    }

    /// Loads the model ahead of the first title; a no-op when it is unavailable.
    AsyncFunction("prewarm") {
      ExpenseClassifier.prewarm()
    }

    /// One of Even's category ids, or null. Resolves within `ExpenseClassifier.timeout` and never rejects.
    AsyncFunction("classifyExpense") { (title: String) async -> String? in
      await ExpenseClassifier.classify(title)
    }
  }
}
