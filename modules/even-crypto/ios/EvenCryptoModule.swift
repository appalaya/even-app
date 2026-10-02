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

    /// `open` for a batch under one key, in one call (the derive opens hundreds at a time). `input` holds, per item,
    /// nonce (24 bytes) || aad || sealed; `lengths` holds, per item, the aad's and the sealed part's lengths; `out`
    /// receives each plaintext (sealed length - 16 bytes) in turn; `opened[i]` is set to 1 or 0. Returns how many
    /// opened, or -1 (nothing read or written) when the layout does not add up exactly.
    Function("openMany") { (key: Uint8Array, input: Uint8Array, lengths: Int32Array, out: Uint8Array, opened: Uint8Array) -> Int in
      let count = opened.byteLength
      guard Self.ready, key.byteLength == Self.keyBytes, lengths.byteLength == count * 2 * MemoryLayout<Int32>.size
      else { return -1 }
      let lens = lengths.rawPointer.assumingMemoryBound(to: Int32.self)
      var inputTotal = 0
      var outTotal = 0
      for i in 0..<count {
        let aadLength = Int(lens[2 * i])
        let sealedLength = Int(lens[2 * i + 1])
        guard aadLength >= 0, sealedLength >= Self.tagBytes else { return -1 }
        inputTotal += Self.nonceBytes + aadLength + sealedLength
        outTotal += sealedLength - Self.tagBytes
      }
      guard inputTotal == input.byteLength, outTotal == out.byteLength else { return -1 }

      let source = bytes(input)
      let target = bytes(out)
      let flags = bytes(opened)
      let secret = bytes(key)
      var inAt = 0
      var outAt = 0
      var openedCount = 0
      for i in 0..<count {
        let aadLength = Int(lens[2 * i])
        let sealedLength = Int(lens[2 * i + 1])
        let nonce = source + inAt
        let aad = nonce + Self.nonceBytes
        let sealed = aad + aadLength
        var written: UInt64 = 0
        let result = crypto_aead_xchacha20poly1305_ietf_decrypt(
          target + outAt, &written, nil,
          sealed, UInt64(sealedLength),
          aad, UInt64(aadLength),
          nonce, secret)
        let ok = result == 0 && written == UInt64(sealedLength - Self.tagBytes)
        flags[i] = ok ? 1 : 0
        if ok { openedCount += 1 }
        inAt += Self.nonceBytes + aadLength + sealedLength
        outAt += sealedLength - Self.tagBytes
      }
      return openedCount
    }
  }
}

/// The typed array's bytes (its byteOffset applied). For an empty array Expo substitutes a non-null sentinel that
/// libsodium never dereferences, since every length passed with it is 0.
private func bytes(_ array: Uint8Array) -> UnsafeMutablePointer<UInt8> {
  return array.rawPointer.assumingMemoryBound(to: UInt8.self)
}
