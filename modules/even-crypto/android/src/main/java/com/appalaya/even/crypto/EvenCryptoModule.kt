package com.appalaya.even.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

/**
 * XChaCha20-Poly1305 (IETF) through Google Tink, for JavaScript (modules/even-crypto/src/EvenCryptoModule.ts).
 *
 * Every function is synchronous (JSI) and works on the caller's typed arrays: the bytes are read out, Tink seals or
 * opens them, and the answer is written into the output array JavaScript allocated. Lengths are checked before
 * anything is read, so a wrong-size argument returns false instead of failing inside Tink. Nothing is kept or logged.
 *
 * `InsecureNonceXChaCha20Poly1305` (encrypt and decrypt both take the nonce first) takes the nonce from the caller (envelope.ts draws it from the platform CSPRNG); it
 * is the implementation Tink's public `subtle.XChaCha20Poly1305` wraps, without that class's random nonce prefix.
 * "Insecure" in its name means only that: nonce uniqueness is the caller's job. Its tag check is constant-time
 * (`Bytes.equal`).
 */
class EvenCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EvenCrypto")

    Function("info") {
      mapOf("library" to "tink", "version" to TINK_VERSION)
    }

    Function("seal") { key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array, out: Uint8Array ->
      if (key.byteLength != KEY_BYTES || nonce.byteLength != NONCE_BYTES ||
        out.byteLength != plaintext.byteLength + TAG_BYTES
      ) {
        return@Function false
      }
      try {
        val sealed = InsecureNonceXChaCha20Poly1305(bytesOf(key)).encrypt(bytesOf(nonce), bytesOf(plaintext), bytesOf(aad))
        if (sealed.size != out.byteLength) return@Function false
        out.write(sealed, 0, sealed.size)
        true
      } catch (e: Exception) {
        false // a tag that does not verify (AEADBadTagException), or any other refusal
      }
    }

    Function("open") { key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array, out: Uint8Array ->
      if (key.byteLength != KEY_BYTES || nonce.byteLength != NONCE_BYTES || sealed.byteLength < TAG_BYTES ||
        out.byteLength != sealed.byteLength - TAG_BYTES
      ) {
        return@Function false
      }
      try {
        val plain = InsecureNonceXChaCha20Poly1305(bytesOf(key)).decrypt(bytesOf(nonce), bytesOf(sealed), bytesOf(aad))
        if (plain.size != out.byteLength) return@Function false
        out.write(plain, 0, plain.size)
        true
      } catch (e: Exception) {
        false // a tag that does not verify (AEADBadTagException), or any other refusal
      }
    }
  }

  private companion object {
    const val KEY_BYTES = 32
    const val NONCE_BYTES = 24
    const val TAG_BYTES = 16
    /** Kept equal to the dependency in build.gradle. */
    const val TINK_VERSION = "1.23.0"

    /** A copy of the typed array's bytes (its byteOffset applied). */
    fun bytesOf(array: Uint8Array): ByteArray {
      val bytes = ByteArray(array.byteLength)
      if (bytes.isNotEmpty()) array.read(bytes, 0, bytes.size)
      return bytes
    }
  }
}
