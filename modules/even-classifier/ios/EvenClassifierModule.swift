import ExpoModulesCore

/// `classifyExpense`'s reply: the category and how it came about, never the title (EvenClassifier.types.ts,
/// `ClassifierReply`).
struct ClassifierReply: Record {
  /// A category id (`other` included), or nil.
  @Field var category: String? = nil
  /// answered, other, refused, timeout, error, unavailable or blank (`ExpenseClassifierOutcome`).
  @Field var outcome: String = ExpenseClassifierOutcome.error.rawValue
  /// From the call to the result, a retry included.
  @Field var ms: Int = 0
  /// The model whose attempt decided the outcome: general or contentTagging; nil when none was asked.
  @Field var model: String? = nil
  /// The unavailability reason, or the error's kind ("guardrailViolation").
  @Field var detail: String? = nil
}

/// `EvenClassifier` for JavaScript (modules/even-classifier/src/EvenClassifierModule.ts). The model work lives in
/// ExpenseClassifier.swift, which has no Expo import so scripts/eval-categories.swift can score the same code.
public class EvenClassifierModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EvenClassifier")

    /// `{ status: 'available' }`, or `{ status: 'unavailable', reason }` with the framework's reason:
    /// deviceNotEligible, appleIntelligenceNotEnabled, modelNotReady (or osTooOld, frameworkMissing). Logged.
    AsyncFunction("availability") { () -> [String: String] in
      switch ExpenseClassifier.checkAvailability() {
      case .available:
        return ["status": "available"]
      case .unavailable(let reason):
        return ["status": "unavailable", "reason": reason]
      }
    }

    /// Loads the models ahead of the first title; a no-op for one that is unavailable.
    AsyncFunction("prewarm") {
      ExpenseClassifier.prewarm()
    }

    /// The category and the outcome (`ClassifierReply`). Resolves within `ExpenseClassifier.timeout` and never
    /// rejects.
    AsyncFunction("classifyExpense") { (title: String) async -> ClassifierReply in
      let result = await ExpenseClassifier.classify(title)
      var reply = ClassifierReply()
      reply.category = result.category
      reply.outcome = result.outcome.rawValue
      reply.ms = result.milliseconds
      reply.model = result.model?.rawValue
      reply.detail = result.detail
      return reply
    }
  }
}
