// Ways of asking the on-device model for a category, scored by scripts/eval-categories.swift: the module's own
// `ExpenseClassifier.classify` with each model arrangement (`arrangements`, `shipped` among them), and experimental
// prompts and schemas. None of this ships: the app compiles only modules/even-classifier/ios. Each asker answers one
// title in a fresh session, on the on-device system model only, within the shipped timeout.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// One model reply as the harness records it.
struct Answer: Sendable {
  var category: String?
  /// What became of the request (`ExpenseClassifierOutcome`), for the askers that go through the module's `classify`.
  var outcome: String? = nil
  /// Each attempt as model:outcome:ms, for those askers.
  var attempts: String? = nil
  /// "low", "medium" or "high" for the askers that report one; "3/3" style agreement for the vote.
  var confidence: String? = nil
  /// The merchant kind, for the two-step askers.
  var kind: String? = nil
  var reason: String? = nil
}

/// A way of asking. `hint` is the keyword table's guess when the table matched (nil when it found nothing); askers
/// that take no hint ignore it.
struct Asker: Sendable {
  let name: String
  let summary: String
  let usesHint: Bool
  let ask: @Sendable (_ title: String, _ hint: String?) async -> Answer?
}

#if canImport(FoundationModels)

@available(macOS 26.0, iOS 26.0, *)
@Generable
enum Confidence: String, CaseIterable {
  case low
  case medium
  case high
}

@available(macOS 26.0, iOS 26.0, *)
@Generable
struct CategoryWithConfidence {
  var category: ExpenseCategory
  @Guide(description: "high only when the title plainly names this kind of expense or a business you know; low when you are guessing")
  var confidence: Confidence
}

@available(macOS 26.0, iOS 26.0, *)
@Generable
struct CategoryWithReason {
  @Guide(description: "At most eight words: what the title most likely is")
  var reason: String
  var category: ExpenseCategory
  @Guide(description: "high only when the title plainly names this kind of expense or a business you know; low when you are guessing")
  var confidence: Confidence
}

/// The owner's merchant types, plus the four a category needs that none of them covers (grocery store, transport,
/// parking, car rental). `service` and `other` fall through to the direct answer.
@available(macOS 26.0, iOS 26.0, *)
@Generable
enum MerchantKind: String, CaseIterable {
  case restaurant
  case bar
  case cafe
  case groceryStore
  case hotel
  case airline
  case transport
  case gasStation
  case parking
  case carRental
  case attraction
  case shop
  case pharmacy
  case service
  case other
}

@available(macOS 26.0, iOS 26.0, *)
@Generable
struct KindThenCategory {
  var kind: MerchantKind
  var category: ExpenseCategory
}

let kindToCategory: [String: String] = [
  "restaurant": "food", "bar": "drinks", "cafe": "coffee", "groceryStore": "groceries", "hotel": "lodging",
  "airline": "flights", "transport": "transit", "gasStation": "fuel", "parking": "parking", "carRental": "rental",
  "attraction": "activities", "shop": "shopping", "pharmacy": "health",
]

let kindInstructions = """
  Say what kind of business or thing a shared trip or household expense title is about. A title is often just a \
  business or place name, sometimes misspelled or in another language: answer with the kind of business it is.

  Kinds:
  restaurant: restaurants, fast food, takeout, food delivery, bakeries
  bar: bars, pubs, breweries, wineries, liquor stores
  cafe: coffee shops and tea shops
  groceryStore: supermarkets, grocery and convenience stores, markets
  hotel: hotels, motels, hostels, lodges, vacation rentals, cabins, campsites
  airline: airlines, airfare, baggage and seats
  transport: taxis, ride-hailing, buses, trains, transit cards, ferries, scooters
  gasStation: gas stations, fuel, EV charging
  parking: parking lots, garages, meters, parking apps, valet
  carRental: car, van and RV rentals and car sharing
  attraction: tours, attractions, ski lifts, activity gear rentals, shows, hot springs, spas
  shop: clothing, outdoor gear, souvenirs and other stores
  pharmacy: pharmacies, clinics, doctors and medicine
  service: fees, tips, taxes, tolls, fines, insurance, bank charges, gifts, donations and bills
  other: anything else
  """

/// Few-shot instructions (strategy f), tuned on the train split only. The examples are invented titles, none of
/// them in the eval set.
let fewShotInstructions = """
  You label shared trip and household expenses with one category. Answer with the category only.

  A title is often just a business or place name, sometimes misspelled, lowercase, in another language or an emoji. \
  If the title says what was paid for, label that. Otherwise label what that kind of place mostly sells: a bar is \
  drinks even if you ate there, a pharmacy is health, a supermarket is groceries.

  Categories:
  food: restaurants, meals, takeout, food delivery, bakeries and snacks
  groceries: supermarkets, grocery and convenience stores and food bought to cook
  drinks: bars, pubs, breweries, taprooms, alcohol and liquor stores
  coffee: coffee shops, cafés, coffee and tea drinks
  lodging: hotels, motels, hostels, lodges, huts, vacation rentals, cabins and campsites, and their deposits
  flights: airlines, airfare, baggage, seats and anything bought from an airline
  transit: taxis, ride-hailing, buses, trains, transit cards, shuttles, ferries and scooters
  fuel: gas stations, gas, fuel and EV charging
  parking: parking lots, garages, meters, parking apps and valet
  rental: rented or shared cars, vans, trucks, RVs and campervans
  activities: tickets, tours, lift passes, gear rentals for skiing or the water, attractions, hot springs, spas and shows
  shopping: clothes, outdoor gear, souvenirs, electronics and other store purchases
  fees: bank and ATM fees, tolls, tips, taxes, fines, insurance, visas, roaming and service charges
  health: pharmacies, medicine, doctors, clinics, physio and first aid
  gifts: presents, flowers, cards and donations
  other: only when no category above fits, such as household bills, subscriptions and chores

  Examples:
  Olive Garden: food
  Kwik-E-Mart: groceries
  Craft beer flight: drinks
  Espresso bar: coffee
  Motel 6: lodging
  Ryanair: flights
  Metro pass: transit
  Arco: fuel
  Parking garage: parking
  Budget truck hire: rental
  Kayak tour: activities
  Gap hoodie: shopping
  Parking fine: fees
  Tip for the guide: fees
  Pharmacie: health
  Birthday card: gifts
  Gym membership: other
  """

/// The prompt that shipped first (strategies a to e score it): each category's meaning, before tuning.
let originalInstructions = """
  You label shared trip and household expenses with one category. Answer with the category only.

  A title is often just a business or place name: label what was most likely paid for there.

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
  rental: rented cars, vans, RVs and campervans
  activities: tickets, tours, lift passes, attractions, hot springs, spas and shows
  shopping: clothes, outdoor gear, souvenirs and other store purchases
  fees: bank and ATM fees, tolls, tips, taxes, insurance, visas and service charges
  health: pharmacies, medicine, doctors, clinics and first aid
  gifts: presents, flowers and donations
  other: only when no category above fits, such as household bills
  """

/// The prompt shipped to build 120 (tuned once on train): long lists per category, and drinks never said "beer", so on
/// a phone "Hazy IPA" came back coffee.
let build120Instructions = """
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

/// The variants for the smaller model, beside the shipped one (`ExpenseClassifier.instructions`: five words at most
/// per category, then a sentence per confused pair). Minimal: three words at most per category.
let minimalInstructions = """
  You label shared trip and household expenses with one category. Answer with the category only.

  A title is often just a business or place name: label what is usually paid for there.

  Categories:
  food: restaurants, meals, takeout
  groceries: supermarkets, grocery stores
  drinks: beer, wine, bars
  coffee: cafés, coffee, tea
  lodging: hotels, cabins, campsites
  flights: airlines, airfare
  transit: taxis, buses, trains
  fuel: gas stations, EV charging
  parking: parking lots, meters, valet
  rental: a car, van or RV to drive
  activities: tickets, tours, lift passes
  shopping: clothes, gear, souvenirs
  fees: tips, tolls, fines, bank fees
  health: pharmacies, medicine, doctors
  gifts: presents, flowers, donations
  other: only when nothing above fits, such as bills
  """

/// The pairs the eval set shows confused, one sentence each, as the shipped prompt ends.
let boundarySentences = """
  Beer of any style is drinks, never coffee.
  Food from a store is groceries; other store goods are shopping.
  A place to stay is lodging; a vehicle to drive is rental.
  A ride is transit, filling the tank is fuel, and leaving the car is parking.
  """

/// Minimal, then the boundary sentences.
let minimalBoundaryInstructions = minimalInstructions + "\n\n" + boundarySentences

/// The shipped prompt without its boundary sentences: five words at most per category.
let linesInstructions: String = {
  let shipped = ExpenseClassifier.instructions
  guard let range = shipped.range(of: "\n\n" + boundarySentences) else { return shipped }
  return String(shipped[..<range.lowerBound])
}()

@available(macOS 26.0, iOS 26.0, *)
func session(_ instructions: String, tagging: Bool = false) -> LanguageModelSession {
  let model = tagging ? SystemLanguageModel(useCase: .contentTagging) : SystemLanguageModel.default
  return LanguageModelSession(model: model, instructions: instructions)
}

let greedy: GenerationOptions = GenerationOptions(samplingMode: .greedy)

func hintPrompt(_ title: String, _ hint: String?) -> String {
  guard let hint else { return "Expense title: \(title)" }
  return "Expense title: \(title)\nA keyword match suggests \(hint); keep it unless it is clearly wrong."
}

@available(macOS 26.0, iOS 26.0, *)
func direct(_ instructions: String, tagging: Bool = false, _ prompt: String) async -> Answer? {
  await withTimeout(ExpenseClassifier.timeout) {
    guard let r = try? await session(instructions, tagging: tagging)
      .respond(to: prompt, generating: ExpenseCategory.self, options: greedy)
    else { return Answer(category: nil) }
    return Answer(category: r.content.rawValue)
  }
}

@available(macOS 26.0, iOS 26.0, *)
func withConfidence(_ instructions: String, _ prompt: String) async -> Answer? {
  await withTimeout(ExpenseClassifier.timeout) {
    guard let r = try? await session(instructions)
      .respond(to: prompt, generating: CategoryWithConfidence.self, options: greedy)
    else { return Answer(category: nil) }
    return Answer(category: r.content.category.rawValue, confidence: r.content.confidence.rawValue)
  }
}

@available(macOS 26.0, iOS 26.0, *)
func withReason(_ instructions: String, _ prompt: String) async -> Answer? {
  await withTimeout(ExpenseClassifier.timeout) {
    guard let r = try? await session(instructions)
      .respond(to: prompt, generating: CategoryWithReason.self, options: greedy)
    else { return Answer(category: nil) }
    return Answer(
      category: r.content.category.rawValue, confidence: r.content.confidence.rawValue, reason: r.content.reason)
  }
}

@available(macOS 26.0, iOS 26.0, *)
func twoStep(_ title: String) async -> Answer? {
  let kind: String? = await withTimeout(ExpenseClassifier.timeout) {
    try? await session(kindInstructions)
      .respond(to: "Expense title: \(title)", generating: MerchantKind.self, options: greedy).content.rawValue
  }
  if let kind, let mapped = kindToCategory[kind] { return Answer(category: mapped, kind: kind) }
  // service, other, or no answer: the direct answer decides.
  let fallback = await direct(originalInstructions, "Expense title: \(title)")
  return Answer(category: fallback?.category, kind: kind ?? "none")
}

@available(macOS 26.0, iOS 26.0, *)
func kindFirst(_ title: String) async -> Answer? {
  await withTimeout(ExpenseClassifier.timeout) {
    guard let r = try? await session(originalInstructions)
      .respond(to: "Expense title: \(title)", generating: KindThenCategory.self, options: greedy)
    else { return Answer(category: nil) }
    return Answer(category: r.content.category.rawValue, kind: r.content.kind.rawValue)
  }
}

/// Self-consistency, the one confidence signal the public API allows without log-probabilities: three sampled
/// answers; the majority is the answer and the agreement ("3/3") the confidence.
@available(macOS 26.0, iOS 26.0, *)
func vote(_ instructions: String, _ prompt: String) async -> Answer? {
  var votes: [String: Int] = [:]
  for seed in [UInt64(1), 2, 3] {
    let sampled = GenerationOptions(samplingMode: .random(top: 4, seed: seed), temperature: 1.0)
    let answer: String? = await withTimeout(ExpenseClassifier.timeout) {
      try? await session(instructions).respond(to: prompt, generating: ExpenseCategory.self, options: sampled)
        .content.rawValue
    }
    if let answer { votes[answer, default: 0] += 1 }
  }
  guard let best = votes.max(by: { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }) else {
    return Answer(category: nil)
  }
  return Answer(category: best.key, confidence: best.value == 3 ? "high" : best.value == 2 ? "medium" : "low")
}

@available(macOS 26.0, iOS 26.0, *)
func prewarm(_ instructions: String) {
  session(instructions).prewarm()
}

#endif

/// The module's own `classify` with a given model arrangement: the first model, then the second after a refusal or
/// an error, within the shipped timeout.
func classified(_ title: String, _ models: [ExpenseClassifierModel]) async -> Answer {
  let result = await ExpenseClassifier.classify(title, models: models)
  let attempts = result.attempts.map { "\($0.model.rawValue):\($0.outcome.rawValue):\($0.milliseconds)" }
  return Answer(
    category: result.category, outcome: result.outcome.rawValue, attempts: attempts.joined(separator: ","))
}

/// The model arrangements the module can ship, by asker name: which model first, and which retries a refusal or an
/// error. `shipped` is `ExpenseClassifier.models`.
let arrangements: [String: [ExpenseClassifierModel]] = [
  "shipped": ExpenseClassifier.models,
  "general": [.general],
  "contentTagging": [.contentTagging],
  "general+retry": [.general, .contentTagging],
  "contentTagging+retry": [.contentTagging, .general],
]

/// The app's first request after Add expense opens: a session prewarmed `ExpenseClassifier.prewarm` style, then the
/// title half a second later. The module's own path; used to check whether prewarming changes the answer.
func classifiedPrewarmed(_ title: String, _ models: [ExpenseClassifierModel]) async -> Answer {
  ExpenseClassifier.prewarm(models)
  try? await Task.sleep(for: .milliseconds(500))
  return await classified(title, models)
}

/// Every asker the harness knows. `shipped` is exactly what the app ships (ExpenseClassifier.classify with
/// `ExpenseClassifier.models`), and the other arrangements are the same code with other models; a hint is passed only
/// if the shipped signature takes one.
func allAskers() -> [Asker] {
  var askers: [Asker] = arrangements.keys.sorted().map { name in
    let models = arrangements[name] ?? []
    return Asker(
      name: name, summary: "the module's classify with " + models.map(\.rawValue).joined(separator: ", then "),
      usesHint: false
    ) { title, _ in await classified(title, models) }
  }
  askers.append(
    Asker(name: "general-prewarmed", summary: "the module's classify, general, each title on a prewarmed session",
          usesHint: false) { title, _ in await classifiedPrewarmed(title, [.general]) })
  #if canImport(FoundationModels)
  if #available(macOS 26.0, iOS 26.0, *) {
    let base = originalInstructions
    askers += [
      Asker(name: "base", summary: "the original prompt, no hint", usesHint: false) { title, _ in
        await direct(base, "Expense title: \(title)")
      },
      Asker(name: "base+hint", summary: "the original prompt with the table's guess as a hint", usesHint: true) {
        title, hint in await direct(base, hintPrompt(title, hint))
      },
      Asker(name: "base+conf", summary: "the original prompt, answer with a confidence", usesHint: false) { title, _ in
        await withConfidence(base, "Expense title: \(title)")
      },
      Asker(name: "base+reason", summary: "the original prompt, a short reason, then the answer and a confidence",
            usesHint: false) { title, _ in await withReason(base, "Expense title: \(title)") },
      Asker(name: "twostep", summary: "merchant kind first, mapped; the direct answer for service or other",
            usesHint: false) { title, _ in await twoStep(title) },
      Asker(name: "kindfirst", summary: "one answer: merchant kind, then category", usesHint: false) { title, _ in
        await kindFirst(title)
      },
      Asker(name: "tagging", summary: "the original prompt on the content-tagging use case", usesHint: false) {
        title, _ in await direct(base, tagging: true, "Expense title: \(title)")
      },
      Asker(name: "vote", summary: "the original prompt, three samples, majority and agreement", usesHint: false) {
        title, _ in await vote(base, "Expense title: \(title)")
      },
      Asker(name: "tuned", summary: "the shipped prompt (tuned on train), no hint", usesHint: false) { title, _ in
        await direct(ExpenseClassifier.instructions, "Expense title: \(title)")
      },
      Asker(name: "tagging-tuned", summary: "the shipped prompt on the content-tagging use case", usesHint: false) {
        title, _ in await direct(ExpenseClassifier.instructions, tagging: true, "Expense title: \(title)")
      },
      Asker(name: "tuned+hint", summary: "the shipped prompt with the table's guess as a hint", usesHint: true) {
        title, hint in await direct(ExpenseClassifier.instructions, hintPrompt(title, hint))
      },
      Asker(name: "build120", summary: "the prompt shipped to build 120, no hint", usesHint: false) { title, _ in
        await direct(build120Instructions, "Expense title: \(title)")
      },
      Asker(name: "minimal", summary: "the minimal prompt: three words per category", usesHint: false) { title, _ in
        await direct(minimalInstructions, "Expense title: \(title)")
      },
      Asker(name: "minimal+boundaries", summary: "the minimal prompt and the boundary sentences", usesHint: false) {
        title, _ in await direct(minimalBoundaryInstructions, "Expense title: \(title)")
      },
      Asker(name: "lines", summary: "the shipped prompt without its boundary sentences", usesHint: false) {
        title, _ in await direct(linesInstructions, "Expense title: \(title)")
      },
      Asker(name: "fewshot", summary: "the few-shot prompt, no hint", usesHint: false) { title, _ in
        await direct(fewShotInstructions, "Expense title: \(title)")
      },
      Asker(name: "fewshot+hint", summary: "the few-shot prompt with the table's guess as a hint", usesHint: true) {
        title, hint in await direct(fewShotInstructions, hintPrompt(title, hint))
      },
      Asker(name: "fewshot+conf", summary: "the few-shot prompt, answer with a confidence", usesHint: false) {
        title, _ in await withConfidence(fewShotInstructions, "Expense title: \(title)")
      },
    ]
  }
  #endif
  return askers
}

/// Loads each asker's instructions before its first title, as the app does when Add expense opens.
func prewarm(asker: String) {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, iOS 26.0, *) {
    if let models = arrangements[asker] {
      ExpenseClassifier.prewarm(models)
      return
    }
    switch asker {
    case "general-prewarmed": break  // each title prewarms its own session
    case "twostep": prewarm(kindInstructions); prewarm(originalInstructions)
    case let name where name.hasPrefix("fewshot"): prewarm(fewShotInstructions)
    case let name where name.hasPrefix("tuned"): prewarm(ExpenseClassifier.instructions)
    case "tagging-tuned": session(ExpenseClassifier.instructions, tagging: true).prewarm()
    case "build120": prewarm(build120Instructions)
    case "minimal": prewarm(minimalInstructions)
    case "minimal+boundaries": prewarm(minimalBoundaryInstructions)
    case "lines": prewarm(linesInstructions)
    default: prewarm(originalInstructions)
    }
  }
  #endif
}
