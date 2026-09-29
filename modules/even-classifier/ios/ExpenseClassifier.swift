// The on-device category model (design.md "Model refinement"): Apple's Foundation Models system language model,
// with guided generation constrained to Even's sixteen categories. Plain Swift with no Expo import, so
// scripts/eval-categories.swift compiles this same file on a Mac and scores exactly what the app ships.
//
// Only the on-device model, ever: this file uses `SystemLanguageModel.default` and the same on-device model made for
// the content-tagging use case, and nothing else (`systemModel`). Never the Private Cloud Compute model or any other
// `LanguageModel`, so a title never leaves the phone (src/state/categories.test.ts fails if the native sources name
// one).
//
// Diagnostics: every request logs one line through os_log (subsystem com.appalaya.even, category category-model):
// the outcome, the category, the model, the milliseconds and each attempt, and never the title (design.md "Model
// refinement", "Reading the logs").

import Foundation
import os

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Whether the on-device model can answer now. `reason` is the framework's own word for why not.
public enum ExpenseClassifierAvailability: Equatable, Sendable {
  case available
  case unavailable(reason: String)
}

/// Which on-device model is asked. Both are Foundation Models' on-device system language model: `general` is
/// `SystemLanguageModel.default`; `contentTagging` is the same on-device model made for the content-tagging use case.
public enum ExpenseClassifierModel: String, Sendable, CaseIterable {
  case general
  case contentTagging
}

/// What became of a request, as the logs and scripts/eval-categories.swift report it. It never carries the title.
public enum ExpenseClassifierOutcome: String, Sendable {
  /// One of the categories other than `other`.
  case answered
  /// The model answered `other`, which the app treats as no answer (`refineCategory`).
  case other
  /// A guardrail violation or a refusal.
  case refused
  /// No answer within `ExpenseClassifier.timeout`.
  case timeout
  /// Any other error: missing assets, a rate limit, an unsupported language, a cancelled request.
  case error
  /// The model cannot answer on this device now (`detail` is the framework's reason).
  case unavailable
  /// Nothing was asked: the title was blank.
  case blank
}

/// The result of `ExpenseClassifier.classify`: the category, if any, and how it came about.
public struct ExpenseClassification: Sendable {
  /// One model request and what became of it.
  public struct Attempt: Sendable {
    public var model: ExpenseClassifierModel
    public var outcome: ExpenseClassifierOutcome
    public var milliseconds: Int
    /// The error's kind for `refused`, `error` and `timeout` ("guardrailViolation", "rateLimited", ...).
    public var detail: String?
  }

  /// The category id the model answered (`other` included), or nil.
  public var category: String?
  public var outcome: ExpenseClassifierOutcome
  /// The model whose attempt decided the outcome; nil when none was asked.
  public var model: ExpenseClassifierModel?
  /// From the call to its result, the retry included.
  public var milliseconds: Int
  /// Each model asked, in order: two when the first refused or failed.
  public var attempts: [Attempt]
  /// The unavailability reason, or the deciding attempt's error kind.
  public var detail: String?
}

public enum ExpenseClassifier {
  /// The time a title gets, a retry included: a reply after it is dropped and the chip keeps its local guess. A late
  /// reply costs nothing (the chip machine drops a reply whose title has moved on), so this only needs to cover a
  /// phone's first request after the sheet opens.
  public static let timeout: Duration = .seconds(6)

  /// The models asked, in order: the first for every title; the second once more, only when the first refused, hit a
  /// guardrail or failed. Chosen with scripts/eval-categories.swift (design.md "Model refinement"). Both are
  /// prewarmed.
  public static let models: [ExpenseClassifierModel] = [.general, .contentTagging]

  /// Titles are at most 80 characters (the event schema); anything longer is cut before it reaches the model.
  static let maxTitleLength = 80

  static let log = Logger(subsystem: "com.appalaya.even", category: "category-model")

  /// The guide for each category is its meaning in the app (design.md "Categories"), not a copy of the keyword
  /// table. Tuned with scripts/eval-categories.swift on the eval set's train split only: without the guides the model
  /// answered "food" for bars and coffee shops, and household services (dry cleaning, key cutting, storage) came back
  /// as "rental" until rental said "to drive" and other named them. The model is asked only about titles neither
  /// history nor the keyword table knows, and those whose keywords name two categories ("Hotel bar")
  /// (src/features/addExpense/chipMachine.ts, `shouldAskModel`).
  public static let instructions = """
    You label shared trip and household expenses with one category. Answer with the category only.

    A title is often just a business or place name: label what was most likely paid for there. A refund or deposit \
    belongs to what it was for.

    Categories:
    food: restaurants, meals, takeout and food delivery
    groceries: supermarkets, grocery stores and food bought to cook
    drinks: bars, pubs, breweries, alcohol and liquor stores
    coffee: coffee shops, coffee and tea drinks
    lodging: hotels, motels, hostels, vacation rentals, cabins and campsites
    flights: airlines, airfare and anything bought from an airline
    transit: taxis, ride-hailing, buses, trains, shuttles and ferries
    fuel: gas stations, fuel and EV charging
    parking: parking lots, garages, meters and valet
    rental: renting a car, van, truck, RV or campervan to drive
    activities: tickets, tours, lift passes, gear rentals, attractions, hot springs, spas and shows
    shopping: clothes, outdoor gear, souvenirs and other store purchases
    fees: bank and ATM fees, tolls, tips, taxes, fines, insurance, visas and service charges
    health: pharmacies, medicine, doctors, clinics and first aid
    gifts: presents, flowers, registries and donations
    other: only when no category above fits, such as household bills, subscriptions, laundry, repairs, postage and \
    storage
    """

  /// Whether the first model in `models` can answer now. Not logged; `checkAvailability` is the logged one.
  public static func availability() -> ExpenseClassifierAvailability {
    availability(of: models[0])
  }

  public static func availability(of model: ExpenseClassifierModel) -> ExpenseClassifierAvailability {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      switch systemModel(model).availability {
      case .available:
        return .available
      case .unavailable(.deviceNotEligible):
        return .unavailable(reason: "deviceNotEligible")
      case .unavailable(.appleIntelligenceNotEnabled):
        return .unavailable(reason: "appleIntelligenceNotEnabled")
      case .unavailable(.modelNotReady):
        return .unavailable(reason: "modelNotReady")
      case .unavailable(let other):
        return .unavailable(reason: String(describing: other))
      }
    }
    return .unavailable(reason: "osTooOld")
    #else
    return .unavailable(reason: "frameworkMissing")
    #endif
  }

  /// `availability()`, logged: the app asks once per launch, so the log says whether this launch can use the model.
  public static func checkAvailability() -> ExpenseClassifierAvailability {
    let availability = availability()
    switch availability {
    case .available:
      log.notice("availability available")
    case .unavailable(let reason):
      log.notice("availability unavailable reason=\(reason, privacy: .public)")
    }
    return availability
  }

  /// Loads each available model in `models` and the instructions ahead of the first title (the app calls this when
  /// Add expense opens), so the first answer is not a cold start. Each prewarmed session answers the next title asked
  /// of its model only. No-op for a model that is unavailable.
  public static func prewarm(_ models: [ExpenseClassifierModel] = models) {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      var warmed: [String] = []
      for model in models where availability(of: model) == .available {
        let session = newSession(model)
        session.prewarm()
        SpareSessions.shared.put(session, for: model)
        warmed.append(model.rawValue)
      }
      let list = warmed.isEmpty ? "none" : warmed.joined(separator: ",")
      log.notice("prewarm models=\(list, privacy: .public)")
    }
    #endif
  }

  /// The model's category for `title` and how it came about: `models[0]` is asked, and `models[1]` once more when
  /// the first refuses, hits a guardrail or fails. The whole call, retry included, ends within `timeout`. Never
  /// throws; logs one line per call (no title) unless the title is blank.
  public static func classify(
    _ title: String,
    models: [ExpenseClassifierModel] = models,
    timeout: Duration = timeout
  ) async -> ExpenseClassification {
    let clock = ContinuousClock()
    let start = clock.now
    let trimmed = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxTitleLength))
    if trimmed.isEmpty || models.isEmpty {
      return ExpenseClassification(
        category: nil, outcome: .blank, model: nil, milliseconds: 0, attempts: [], detail: nil)
    }
    // A model is available only on iOS 26 or later (`availability(of:)`), so `ready` is empty before it.
    let ready = models.filter { availability(of: $0) == .available }
    var reason = "unknown"
    if case .unavailable(let why) = availability(of: models[0]) { reason = why }
    var result = ExpenseClassification(
      category: nil, outcome: .unavailable, model: nil, milliseconds: 0, attempts: [], detail: reason)
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *), !ready.isEmpty {
      result = await ask(trimmed, Array(ready.prefix(2)), timeout: timeout)
    }
    #endif
    result.milliseconds = milliseconds(start.duration(to: clock.now))
    report(result)
    return result
  }

  static func milliseconds(_ duration: Duration) -> Int {
    Int(duration.components.seconds) * 1000 + Int(duration.components.attoseconds / 1_000_000_000_000_000)
  }

  /// One line per call, never the title: the outcome, the category, the deciding model, the time, and each attempt
  /// as model:outcome:ms (design.md "Reading the logs").
  static func report(_ result: ExpenseClassification) {
    let category = result.category ?? "-"
    let model = result.model?.rawValue ?? "-"
    let detail = result.detail ?? "-"
    let attempts = result.attempts.isEmpty
      ? "-"
      : result.attempts.map { "\($0.model.rawValue):\($0.outcome.rawValue):\($0.milliseconds)" }
        .joined(separator: ",")
    log.notice(
      """
      classify outcome=\(result.outcome.rawValue, privacy: .public) category=\(category, privacy: .public) \
      model=\(model, privacy: .public) ms=\(result.milliseconds, privacy: .public) \
      detail=\(detail, privacy: .public) attempts=\(attempts, privacy: .public)
      """)
  }

  #if canImport(FoundationModels)
  /// The only models this file uses: Foundation Models' on-device system language model, as is or made for content
  /// tagging. Never Private Cloud Compute, never another `LanguageModel`.
  @available(iOS 26.0, macOS 26.0, *)
  static func systemModel(_ model: ExpenseClassifierModel) -> SystemLanguageModel {
    switch model {
    case .general: return SystemLanguageModel.default
    case .contentTagging: return SystemLanguageModel(useCase: .contentTagging)
    }
  }

  /// The only way a session is made: an on-device system model with Even's instructions.
  @available(iOS 26.0, macOS 26.0, *)
  static func newSession(_ model: ExpenseClassifierModel) -> LanguageModelSession {
    LanguageModelSession(model: systemModel(model), instructions: instructions)
  }

  /// Asks `models` in order within `timeout`: the next model only after a refusal or an error.
  @available(iOS 26.0, macOS 26.0, *)
  static func ask(_ title: String, _ models: [ExpenseClassifierModel], timeout: Duration) async
    -> ExpenseClassification
  {
    let progress = Progress()
    let answered: ExpenseClassification? = await withTimeout(timeout) {
      let clock = ContinuousClock()
      for (index, model) in models.enumerated() {
        progress.asking(model, at: clock.now)
        let (category, outcome, detail) = await askOnce(title, model)
        let attempt = ExpenseClassification.Attempt(
          model: model, outcome: outcome, milliseconds: progress.elapsed(clock.now), detail: detail)
        progress.record(attempt)
        let retry = (outcome == .refused || outcome == .error) && index + 1 < models.count
        if retry { continue }
        return ExpenseClassification(
          category: category, outcome: outcome, model: model, milliseconds: 0, attempts: progress.attempts,
          detail: detail)
      }
      return nil
    }
    if let answered { return answered }
    // Time ran out: the attempt in flight is the one that timed out.
    let (model, attempts) = progress.timedOut(ContinuousClock().now)
    return ExpenseClassification(
      category: nil, outcome: .timeout, model: model, milliseconds: 0, attempts: attempts, detail: nil)
  }

  /// One request to one model, in a fresh session (the prewarmed spare counts: it has answered nothing yet): no
  /// earlier title sits in the transcript to sway this one, and two requests in flight (a pause, more typing,
  /// another pause) never share a session.
  @available(iOS 26.0, macOS 26.0, *)
  static func askOnce(_ title: String, _ model: ExpenseClassifierModel) async
    -> (category: String?, outcome: ExpenseClassifierOutcome, detail: String?)
  {
    let session = SpareSessions.shared.take(model) ?? newSession(model)
    do {
      let response = try await session.respond(
        to: "Expense title: \(title)",
        generating: ExpenseCategory.self,
        options: GenerationOptions(samplingMode: .greedy)
      )
      let id = response.content.rawValue
      return (id, id == ExpenseCategory.other.rawValue ? .other : .answered, nil)
    } catch {
      let (outcome, detail) = describe(error)
      return (nil, outcome, detail)
    }
  }

  /// What an error means for the chip, and its kind for the log (a case or type name, never its message, which may
  /// quote the prompt).
  @available(iOS 26.0, macOS 26.0, *)
  static func describe(_ error: any Error) -> (ExpenseClassifierOutcome, String) {
    if error is CancellationError { return (.error, "cancelled") }
    if #available(iOS 27.0, macOS 27.0, *), let error = error as? LanguageModelError {
      switch error {
      case .guardrailViolation: return (.refused, "guardrailViolation")
      case .refusal: return (.refused, "refusal")
      case .timeout: return (.timeout, "timeout")
      case .contextSizeExceeded: return (.error, "contextSizeExceeded")
      case .rateLimited: return (.error, "rateLimited")
      case .unsupportedCapability: return (.error, "unsupportedCapability")
      case .unsupportedTranscriptContent: return (.error, "unsupportedTranscriptContent")
      case .unsupportedGenerationGuide: return (.error, "unsupportedGenerationGuide")
      case .unsupportedLanguageOrLocale: return (.error, "unsupportedLanguageOrLocale")
      @unknown default: return (.error, "languageModelError")
      }
    }
    // iOS 26's LanguageModelSession.GenerationError (a guardrail included) and anything else: an error, by type.
    return (.error, String(describing: type(of: error)))
  }
  #endif
}

/// The attempts of one `classify` call so far, readable when the timeout cuts it short.
final class Progress: @unchecked Sendable {
  private let lock = NSLock()
  private var done: [ExpenseClassification.Attempt] = []
  private var current: (model: ExpenseClassifierModel, since: ContinuousClock.Instant)?

  var attempts: [ExpenseClassification.Attempt] {
    lock.lock()
    defer { lock.unlock() }
    return done
  }

  func asking(_ model: ExpenseClassifierModel, at now: ContinuousClock.Instant) {
    lock.lock()
    current = (model, now)
    lock.unlock()
  }

  func elapsed(_ now: ContinuousClock.Instant) -> Int {
    lock.lock()
    defer { lock.unlock() }
    guard let current else { return 0 }
    return ExpenseClassifier.milliseconds(current.since.duration(to: now))
  }

  func record(_ attempt: ExpenseClassification.Attempt) {
    lock.lock()
    done.append(attempt)
    current = nil
    lock.unlock()
  }

  /// The model in flight when time ran out, and the attempts with that one added as a timeout.
  func timedOut(_ now: ContinuousClock.Instant) -> (ExpenseClassifierModel?, [ExpenseClassification.Attempt]) {
    lock.lock()
    defer { lock.unlock() }
    guard let current else { return (done.last?.model, done) }
    let attempt = ExpenseClassification.Attempt(
      model: current.model, outcome: .timeout,
      milliseconds: ExpenseClassifier.milliseconds(current.since.duration(to: now)), detail: nil)
    return (current.model, done + [attempt])
  }
}

#if canImport(FoundationModels)
/// Even's categories, in the order and with the ids of `CATEGORIES` in packages/core/src/types.ts
/// (src/state/categories.test.ts checks they match). Guided generation can only produce one of these cases.
@available(iOS 26.0, macOS 26.0, *)
@Generable
enum ExpenseCategory: String, CaseIterable {
  case food
  case groceries
  case drinks
  case coffee
  case lodging
  case flights
  case transit
  case fuel
  case parking
  case rental
  case activities
  case shopping
  case fees
  case health
  case gifts
  case other
}
#endif

#if canImport(FoundationModels)
/// Holds at most one prewarmed, unused session per model, for the next title asked of it.
@available(iOS 26.0, macOS 26.0, *)
final class SpareSessions: @unchecked Sendable {
  static let shared = SpareSessions()
  private let lock = NSLock()
  private var sessions: [ExpenseClassifierModel: LanguageModelSession] = [:]

  func put(_ session: LanguageModelSession, for model: ExpenseClassifierModel) {
    lock.lock()
    sessions[model] = session
    lock.unlock()
  }

  func take(_ model: ExpenseClassifierModel) -> LanguageModelSession? {
    lock.lock()
    defer { lock.unlock() }
    return sessions.removeValue(forKey: model)
  }
}
#endif

// MARK: - Timeout

/// Runs `operation`, but returns nil once `timeout` passes, cancelling the operation. Returns at the deadline even
/// if the operation ignores cancellation.
func withTimeout<T: Sendable>(
  _ timeout: Duration,
  _ operation: @escaping @Sendable () async -> T?
) async -> T? {
  await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
    let race = FirstFinisher(continuation)
    race.track(Task { race.finish(await operation()) })
    race.track(Task {
      try? await Task.sleep(for: timeout)
      race.finish(nil)
    })
  }
}

/// Resumes the continuation once, with whichever result arrives first, and cancels whatever is still running.
private final class FirstFinisher<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T?, Never>?
  private var tasks: [Task<Void, Never>] = []

  init(_ continuation: CheckedContinuation<T?, Never>) {
    self.continuation = continuation
  }

  func track(_ task: Task<Void, Never>) {
    lock.lock()
    let finished = continuation == nil
    if !finished { tasks.append(task) }
    lock.unlock()
    if finished { task.cancel() }
  }

  func finish(_ value: T?) {
    lock.lock()
    let resume = continuation
    continuation = nil
    let running = tasks
    tasks = []
    lock.unlock()
    guard let resume else { return }
    for task in running { task.cancel() }
    resume.resume(returning: value)
  }
}
