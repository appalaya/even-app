// The on-device category model (design.md "Model refinement"): Apple's Foundation Models system language model,
// with guided generation constrained to Even's sixteen categories. Plain Swift with no Expo import, so
// scripts/eval-categories.swift compiles this same file on a Mac and scores exactly what the app ships.
//
// Only the on-device model, ever: this file uses `SystemLanguageModel.default` and nothing else. Never the Private
// Cloud Compute model or any other `LanguageModel`, so a title never leaves the phone (src/state/categories.test.ts
// fails if the native sources name one).

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Whether the on-device model can answer now. `reason` is the framework's own word for why not.
public enum ExpenseClassifierAvailability: Equatable, Sendable {
  case available
  case unavailable(reason: String)
}

public enum ExpenseClassifier {
  /// A reply that takes longer than this is dropped and the keyword guess stays on the chip.
  public static let timeout: Duration = .milliseconds(2500)

  /// Titles are at most 80 characters (the event schema); anything longer is cut before it reaches the model.
  static let maxTitleLength = 80

  /// The guide for each category is its meaning in the app (design.md "Categories"), not a copy of the keyword
  /// table. Tuned with scripts/eval-categories.swift on the eval set's train split only: without the guides the model
  /// answered "food" for bars and coffee shops, and household services (dry cleaning, key cutting, storage) came back
  /// as "rental" until rental said "to drive" and other named them. The model is asked only about titles neither
  /// history nor the keyword table knows (src/features/addExpense/chipMachine.ts, `shouldAskModel`).
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

  public static func availability() -> ExpenseClassifierAvailability {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
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

  /// Loads the model and the instructions ahead of the first title (the app calls this when Add expense opens), so
  /// the first answer is not a cold start: 0.7 to 1.5 s cold against 0.4 s prewarmed on an M6 Mac, and a phone's cold
  /// start can pass the timeout. The prewarmed session answers the next title only. No-op when unavailable.
  public static func prewarm() {
    guard availability() == .available else { return }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      let session = newSession()
      session.prewarm()
      SpareSession.shared.put(session)
    }
    #endif
  }

  /// The model's category id for `title`, or nil: no model, a blank title, a refusal or guardrail, any other error,
  /// or no answer within `timeout`. Never throws.
  public static func classify(_ title: String, timeout: Duration = timeout) async -> String? {
    let trimmed = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxTitleLength))
    if trimmed.isEmpty || availability() != .available { return nil }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
      return await withTimeout(timeout) { await ask(trimmed) }
    }
    #endif
    return nil
  }

  #if canImport(FoundationModels)
  /// The only way a session is made: the on-device system model with Even's instructions.
  @available(iOS 26.0, macOS 26.0, *)
  static func newSession() -> LanguageModelSession {
    LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
  }

  @available(iOS 26.0, macOS 26.0, *)
  static func ask(_ title: String) async -> String? {
    // A fresh session per title (the prewarmed spare counts: it has answered nothing yet): no earlier title sits in
    // the transcript to sway this one, and two requests in flight (a pause, more typing, another pause) never share
    // a session.
    let session = SpareSession.shared.take() ?? newSession()
    do {
      let response = try await session.respond(
        to: "Expense title: \(title)",
        generating: ExpenseCategory.self,
        options: GenerationOptions(samplingMode: .greedy)
      )
      return response.content.rawValue
    } catch {
      // Guardrails, refusals, unsupported language, cancellation by the timeout: the keyword guess stands.
      #if DEBUG
      print("EvenClassifier: no answer (\(type(of: error)))")
      #endif
      return nil
    }
  }
  #endif
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
/// Holds at most one prewarmed, unused session for the next title.
@available(iOS 26.0, macOS 26.0, *)
final class SpareSession: @unchecked Sendable {
  static let shared = SpareSession()
  private let lock = NSLock()
  private var session: LanguageModelSession?

  func put(_ session: LanguageModelSession) {
    lock.lock()
    self.session = session
    lock.unlock()
  }

  func take() -> LanguageModelSession? {
    lock.lock()
    defer { lock.unlock() }
    let spare = session
    session = nil
    return spare
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
