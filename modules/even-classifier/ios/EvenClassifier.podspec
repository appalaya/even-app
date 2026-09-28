Pod::Spec.new do |s|
  s.name           = 'EvenClassifier'
  s.version        = '1.0.0'
  s.summary        = 'Even: the on-device model that names an expense category from its title'
  s.description    = 'Apple Foundation Models (the on-device system language model only) behind an Expo module.'
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

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
