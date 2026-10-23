require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'ShapeTowerGameServices'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://github.com/BlakePixHil/shape_tower'
  s.author = 'Shape Tower'
  s.source = { :git => 'https://github.com/BlakePixHil/shape_tower.git', :tag => package['version'] }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.frameworks = 'GameKit'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
