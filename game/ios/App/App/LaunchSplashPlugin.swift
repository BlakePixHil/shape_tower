import Capacitor
import UIKit

/// The game's splash has painted (src/native.ts hideLaunchSplash): the launch screen behind it can go.
@objc(LaunchSplashPlugin)
public class LaunchSplashPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LaunchSplashPlugin"
    public let jsName = "LaunchSplash"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise)
    ]

    /// The game's sky, behind the web view from now on.
    private static let sky = UIColor(red: 0x6E / 255.0, green: 0xC3 / 255.0, blue: 0xFF / 255.0, alpha: 1)

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.dropLaunchScreen(sky: Self.sky)
            call.resolve()
        }
    }
}
