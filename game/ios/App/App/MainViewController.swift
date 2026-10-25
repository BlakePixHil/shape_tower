import Capacitor
import UIKit

/// The app's bridge view controller. Like Android's MainActivity, it keeps the launch screen behind a
/// see-through web view until the game's own splash, the same picture, has painted over it
/// (LaunchSplashPlugin.hide): no blank frame between the two.
class MainViewController: CAPBridgeViewController {
    private var launchScreen: UIView?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LaunchSplashPlugin())
        guard let webView = webView,
              let screen = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()?.view
        else { return }
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // Under the web view's own scroll view, so the page paints on top of it.
        screen.translatesAutoresizingMaskIntoConstraints = false
        webView.insertSubview(screen, at: 0)
        NSLayoutConstraint.activate([
            screen.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            screen.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            screen.topAnchor.constraint(equalTo: webView.topAnchor),
            screen.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])
        launchScreen = screen
    }

    /// The game's splash covers the screen now: the sky goes behind the web view instead.
    func dropLaunchScreen(sky: UIColor) {
        guard let screen = launchScreen, let webView = webView else { return }
        launchScreen = nil
        webView.backgroundColor = sky
        webView.scrollView.backgroundColor = sky
        webView.isOpaque = true
        screen.removeFromSuperview()
    }
}
