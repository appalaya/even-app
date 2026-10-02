import Clibsodium
import ExpoModulesCore

/// XChaCha20-Poly1305 (IETF) through libsodium, for JavaScript (modules/even-crypto/src/EvenCryptoModule.ts).
///
/// Every function is synchronous and works in place on the caller's typed arrays (JSI): JavaScript allocates the
/// output, libsodium writes into it, nothing is copied through the bridge and nothing is kept. The lengths are
/// checked here before any pointer is used, so a wrong-size argument returns false instead of reading or writing
/// outside a buffer. Nothing is logged. libsodium's verification is constant-time, and a failed open leaves zeros.
public class EvenCryptoModule: Module {
  static let keyBytes = Int(crypto_aead_xchacha20poly1305_ietf_KEYBYTES)
  static let nonceBytes = Int(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  static let tagBytes = Int(crypto_aead_xchacha20poly1305_ietf_ABYTES)

  /// sodium_init picks the fastest implementations for this CPU; it is idempotent and thread-safe. -1 means it could
  /// not initialise, and then every function refuses (the app keeps @noble).
  static let ready: Bool = sodium_init() >= 0

  public func definition() -> ModuleDefinition {
    Name("EvenCrypto")

    Function("info") { () -> [String: String] in
      return ["library": "libsodium", "version": String(cString: sodium_version_string())]
    }

    Function("seal") { (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array, out: Uint8Array) -> Bool in
      guard Self.ready, key.byteLength == Self.keyBytes, nonce.byteLength == Self.nonceBytes,
        out.byteLength == plaintext.byteLength + Self.tagBytes
      else { return false }
      var written: UInt64 = 0
      let result = crypto_aead_xchacha20poly1305_ietf_encrypt(
        bytes(out), &written,
        bytes(plaintext), UInt64(plaintext.byteLength),
        bytes(aad), UInt64(aad.byteLength),
        nil, bytes(nonce), bytes(key))
      return result == 0 && written == UInt64(out.byteLength)
    }

    Function("open") { (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array, out: Uint8Array) -> Bool in
      guard Self.ready, key.byteLength == Self.keyBytes, nonce.byteLength == Self.nonceBytes,
        sealed.byteLength >= Self.tagBytes, out.byteLength == sealed.byteLength - Self.tagBytes
      else { return false }
      var written: UInt64 = 0
      let result = crypto_aead_xchacha20poly1305_ietf_decrypt(
        bytes(out), &written, nil,
        bytes(sealed), UInt64(sealed.byteLength),
        bytes(aad), UInt64(aad.byteLength),
        bytes(nonce), bytes(key))
      return result == 0 && written == UInt64(out.byteLength)
    }
  }
}

/// The typed array's bytes (its byteOffset applied). For an empty array Expo substitutes a non-null sentinel that
/// libsodium never dereferences, since every length passed with it is 0.
private func bytes(_ array: Uint8Array) -> UnsafeMutablePointer<UInt8> {
  return array.rawPointer.assumingMemoryBound(to: UInt8.self)
}
