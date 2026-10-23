import Capacitor
import GameKit
import UIKit

/// Achievements on Game Center (gameplay.md §18.5); src/meta/stores.ts drives it. The device stays the source
/// of truth: this only passes unlocks and progress on, while the player is signed in. The game never asks
/// for sign-in by itself: Game Center signs returning players in at launch, and its sign-in sheet is kept
/// and shown only when the player taps the Achievements button (signIn). Needs the Game Center capability
/// on the app target (com.apple.developer.game-center).
@objc(GameServicesPlugin)
public class GameServicesPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameServicesPlugin"
    public let jsName = "GameServices"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "progress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise)
    ]

    /// Game Center's sign-in sheet, kept until the player asks for it.
    private var signInSheet: UIViewController?
    /// signIn calls waiting for the sheet to finish.
    private var waiting: [CAPPluginCall] = []
    /// The show call, resolved when Game Center's screen closes.
    private var showing: CAPPluginCall?

    private var signedIn: Bool { GKLocalPlayer.local.isAuthenticated }

    override public func load() {
        // Setting the handler starts Game Center's own sign-in; it calls back again whenever that changes.
        GKLocalPlayer.local.authenticateHandler = { [weak self] sheet, _ in
            guard let self = self else { return }
            self.signInSheet = sheet
            if sheet == nil {
                let calls = self.waiting
                self.waiting = []
                calls.forEach { $0.resolve(self.state()) }
            }
            self.notifyListeners("signInChanged", data: ["signedIn": self.signedIn])
        }
    }

    private func state() -> [String: Any] {
        return ["available": true, "signedIn": signedIn, "service": "gamecenter"]
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    /// Shows Game Center's sign-in sheet if it has one waiting; from the Achievements button only.
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.signedIn, let sheet = self.signInSheet, let host = self.bridge?.viewController else {
                call.resolve(self.state())
                return
            }
            self.waiting.append(call)
            self.signInSheet = nil
            host.present(sheet, animated: true)
        }
    }

    /// Unlocks one achievement by its Game Center id. Repeats are free: Game Center keeps the highest percent.
    @objc func unlock(_ call: CAPPluginCall) {
        report(call, percent: 100)
    }

    /// A counted achievement's progress as a percent of its goal.
    @objc func progress(_ call: CAPPluginCall) {
        let steps = Double(call.getInt("steps") ?? 0)
        let total = Double(call.getInt("total") ?? 0)
        report(call, percent: total > 0 ? min(100, steps / total * 100) : 0)
    }

    private func report(_ call: CAPPluginCall, percent: Double) {
        let id = call.getString("id") ?? ""
        guard signedIn, !id.isEmpty, percent > 0 else {
            call.resolve(["sent": false])
            return
        }
        let achievement = GKAchievement(identifier: id)
        achievement.percentComplete = percent
        // The game shows its own toast.
        achievement.showsCompletionBanner = false
        GKAchievement.report([achievement]) { error in
            call.resolve(["sent": error == nil])
        }
    }

    /// Game Center's achievements screen.
    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.signedIn, let host = self.bridge?.viewController else {
                call.reject("Not signed in to Game Center")
                return
            }
            let screen = GKGameCenterViewController(state: .achievements)
            screen.gameCenterDelegate = self
            self.showing = call
            host.present(screen, animated: true)
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
        showing?.resolve(state())
        showing = nil
    }
}
