Pod::Spec.new do |s|
  s.name           = 'EvenCrypto'
  s.version        = '1.0.0'
  s.summary        = 'Even: XChaCha20-Poly1305 seal and open in native code'
  s.description    = 'libsodium (crypto_aead_xchacha20poly1305_ietf_*) behind an Expo module, over JSI typed arrays.'
  s.author         = 'Appalaya Inc'
  s.homepage       = 'https://even.appalaya.com'
  s.license        = { type: 'MIT' }
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # libsodium, as swift-sodium's Clibsodium product (its prebuilt libsodium xcframework, nothing of its Swift API), a
  # Swift package added to this pod's target by React Native's spm_dependency (scripts/cocoapods/spm.rb). Pinned
  # exactly: 0.11.0 carries libsodium 1.0.22.
  spm_dependency(s,
    url: 'https://github.com/jedisct1/swift-sodium.git',
    requirement: { kind: 'exactVersion', version: '0.11.0' },
    products: ['Clibsodium'])

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  # Tests never compile into the app, wherever they are added later.
  s.exclude_files = ["Tests/**/*", "**/*Tests/**/*", "**/*Tests.swift", "**/*Test.swift"]
end
