package com.appalaya.even.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Int32Array
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * XChaCha20-Poly1305 (IETF) through Google Tink, for JavaScript (modules/even-crypto/src/EvenCryptoModule.ts).
 *
 * Every function is synchronous (JSI) and works on the caller's typed arrays: the bytes are read out, Tink seals or
 * opens them, and the answer is written into the output array JavaScript allocated. Lengths are checked before
 * anything is read, so a wrong-size argument returns false instead of failing inside Tink. Nothing is kept or logged.
 * The module's own copies of the key and of every plaintext are zeroed once used; Tink's internal copies (its key
 * state, the buffers it decrypts into before returning) are not, and wait for the garbage collector.
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
      val keyBytes = bytesOf(key)
      val plainBytes = bytesOf(plaintext)
      try {
        val sealed = InsecureNonceXChaCha20Poly1305(keyBytes).encrypt(bytesOf(nonce), plainBytes, bytesOf(aad))
        if (sealed.size != out.byteLength) return@Function false
        out.write(sealed, 0, sealed.size)
        true
      } catch (e: Exception) {
        false // Tink refused (it checks the lengths again), or failed in some other way: nothing is written
      } finally {
        keyBytes.fill(0)
        plainBytes.fill(0)
      }
    }

    Function("open") { key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array, out: Uint8Array ->
      if (key.byteLength != KEY_BYTES || nonce.byteLength != NONCE_BYTES || sealed.byteLength < TAG_BYTES ||
        out.byteLength != sealed.byteLength - TAG_BYTES
      ) {
        return@Function false
      }
      val keyBytes = bytesOf(key)
      var plain: ByteArray? = null
      try {
        plain = InsecureNonceXChaCha20Poly1305(keyBytes).decrypt(bytesOf(nonce), bytesOf(sealed), bytesOf(aad))
        if (plain.size != out.byteLength) return@Function false
        out.write(plain, 0, plain.size)
        true
      } catch (e: Exception) {
        false // a tag that does not verify (AEADBadTagException), or any other refusal
      } finally {
        keyBytes.fill(0)
        plain?.fill(0)
      }
    }

    // `open` for a batch under one key, in one call (the derive opens hundreds at a time). `input` holds, per item,
    // nonce (24 bytes) || aad || sealed; `lengths` holds, per item, the aad's and the sealed part's lengths; `out`
    // receives each plaintext (sealed length - 16 bytes) in turn; `opened[i]` is set to 1 or 0. Returns how many
    // opened, or -1 (nothing written) when the layout does not add up exactly. One copy in, one copy out, and the
    // key schedule once for the batch.
    Function("openMany") { key: Uint8Array, input: Uint8Array, lengths: Int32Array, out: Uint8Array, opened: Uint8Array ->
      val count = opened.byteLength
      if (key.byteLength != KEY_BYTES || lengths.byteLength != count * 2 * Int.SIZE_BYTES) return@Function -1
      val lens = IntArray(count * 2)
      if (count > 0) {
        val raw = ByteArray(lengths.byteLength)
        lengths.read(raw, 0, raw.size)
        ByteBuffer.wrap(raw).order(ByteOrder.nativeOrder()).asIntBuffer().get(lens)
      }
      var inputTotal = 0L
      var outTotal = 0L
      for (i in 0 until count) {
        val aadLength = lens[2 * i]
        val sealedLength = lens[2 * i + 1]
        if (aadLength < 0 || sealedLength < TAG_BYTES) return@Function -1
        inputTotal += NONCE_BYTES + aadLength + sealedLength
        outTotal += sealedLength - TAG_BYTES
      }
      if (inputTotal != input.byteLength.toLong() || outTotal != out.byteLength.toLong()) return@Function -1

      val keyBytes = bytesOf(key)
      val cipher = try {
        InsecureNonceXChaCha20Poly1305(keyBytes)
      } catch (e: Exception) {
        return@Function -1
      } finally {
        keyBytes.fill(0) // Tink keeps its own copy for the batch; this one is the module's
      }
      val source = bytesOf(input)
      val target = ByteArray(out.byteLength)
      val flags = ByteArray(count)
      var inAt = 0
      var outAt = 0
      var openedCount = 0
      for (i in 0 until count) {
        val aadLength = lens[2 * i]
        val sealedLength = lens[2 * i + 1]
        val nonce = source.copyOfRange(inAt, inAt + NONCE_BYTES)
        val aad = source.copyOfRange(inAt + NONCE_BYTES, inAt + NONCE_BYTES + aadLength)
        try {
          val plain = cipher.decrypt(ByteBuffer.wrap(source, inAt + NONCE_BYTES + aadLength, sealedLength), nonce, aad)
          if (plain.size == sealedLength - TAG_BYTES) {
            System.arraycopy(plain, 0, target, outAt, plain.size)
            flags[i] = 1
            openedCount += 1
          }
          plain.fill(0)
        } catch (e: Exception) {
          // Not opened: its flag stays 0 and its slot in `out` zeros.
        }
        inAt += NONCE_BYTES + aadLength + sealedLength
        outAt += sealedLength - TAG_BYTES
      }
      if (target.isNotEmpty()) out.write(target, 0, target.size)
      target.fill(0)
      if (count > 0) opened.write(flags, 0, count)
      openedCount
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
