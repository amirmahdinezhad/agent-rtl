import AppKit
import CoreText
import CryptoKit
import UniformTypeIdentifiers
import Darwin

enum Palette {
    static func color(_ light: UInt32, _ dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        }
    }
    static let canvas = color(0xFFFFFF, 0x252529)
    static let surface = color(0xF5F5F7, 0x303035)
    static let text = color(0x25252A, 0xF4F4F6)
    static let muted = color(0x6B6B75, 0xB0B0BA)
    static var selectedAccent: NSColor? = color(0xAD8CF3, 0xAD8CF3)
    static var accent: NSColor { selectedAccent ?? color(0xAD8CF3, 0xAD8CF3) }
    static var onAccent: NSColor { .black }
    // Use the selected accent for primary actions in both appearances.
    static var primary: NSColor { accent }
    static let line = color(0xE8E8ED, 0x3C3C44)
}

func drawBrand(in rect: NSRect) {
    let side = min(rect.width, rect.height)
    Palette.primary.setFill()
    NSBezierPath(roundedRect: rect, xRadius: side * 0.23, yRadius: side * 0.23).fill()
    let path = NSBezierPath(); path.lineWidth = side * 0.058; path.lineCapStyle = .round; path.lineJoinStyle = .round
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: rect.minX + side * x / 24, y: rect.minY + side * y / 24) }
    path.move(to: point(5, 16)); path.line(to: point(18, 16)); path.move(to: point(14.5, 19.5)); path.line(to: point(18, 16)); path.line(to: point(14.5, 12.5))
    path.move(to: point(19, 8)); path.line(to: point(6, 8)); path.move(to: point(9.5, 11.5)); path.line(to: point(6, 8)); path.line(to: point(9.5, 4.5))
    Palette.onAccent.setStroke(); path.stroke()
}

final class BrandView: NSView {
    override func draw(_ dirtyRect: NSRect) { drawBrand(in: bounds) }
}

final class CanvasView: NSView {
    override func draw(_ dirtyRect: NSRect) { Palette.canvas.setFill(); dirtyRect.fill() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
}

// A solid purple action keeps the primary control legible across macOS appearances.
final class ActionButton: NSButton {
    var primary = true { didSet { needsDisplay = true } }
    private var hovered = false
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func highlight(_ flag: Bool) { super.highlight(flag); needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        let fill = primary ? Palette.primary : Palette.surface
        (isEnabled ? fill : Palette.line).setFill()
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12); shape.fill()
        if !primary { Palette.line.setStroke(); shape.lineWidth = 1; shape.stroke() }
        if isEnabled && (hovered || isHighlighted) { NSColor.black.withAlphaComponent(isHighlighted ? 0.14 : 0.06).setFill(); shape.fill() }
        let attributes: [NSAttributedString.Key: Any] = [.font: appFont(14, bold: true), .foregroundColor: isEnabled ? (primary ? Palette.onAccent : Palette.text) : Palette.muted]
        let size = (title as NSString).size(withAttributes: attributes)
        (title as NSString).draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2), withAttributes: attributes)
        if window?.firstResponder === self { Palette.accent.setStroke(); let ring = NSBezierPath(roundedRect: bounds.insetBy(dx: 3, dy: 3), xRadius: 9, yRadius: 9); ring.lineWidth = 2; ring.stroke() }
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
}

final class ProgressView: NSView {
    var doubleValue: Double = 0 { didSet { needsDisplay = true; setAccessibilityValue(doubleValue) } }
    override func draw(_ dirtyRect: NSRect) {
        Palette.line.setFill(); NSBezierPath(roundedRect: bounds, xRadius: 3, yRadius: 3).fill()
        let value = min(1, max(0, doubleValue / 100))
        if value > 0 { Palette.accent.setFill(); NSBezierPath(roundedRect: NSRect(x: bounds.minX, y: 0, width: bounds.width * value, height: bounds.height), xRadius: 3, yRadius: 3).fill() }
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
}

// Generate the app icon from the same vector mark used in the interface.
if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--write-icon" {
    guard let size = Int(CommandLine.arguments[3]), (16...1024).contains(size),
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(2) }
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    let margin = CGFloat(size) * 0.08
    drawBrand(in: NSRect(x: margin, y: margin, width: CGFloat(size) - margin * 2, height: CGFloat(size) - margin * 2))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(3) }
    do { try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2])); exit(0) } catch { exit(4) }
}

// This executable is also the low-memory verifier used by the coordinator.
if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--verify" {
    do {
        guard let key = Data(base64Encoded: CommandLine.arguments[3]), let signature = Data(base64Encoded: CommandLine.arguments[4]) else { exit(2) }
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: key)
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]), options: .mappedIfSafe)
        guard publicKey.isValidSignature(signature, for: data) else { exit(3) }
        exit(0)
    } catch { fputs("Update signature verification failed.\n", stderr); exit(4) }
}

var customAppFont: String?
func appFont(_ size: CGFloat, bold: Bool = false) -> NSFont {
    if let name = customAppFont, let font = NSFont(name: name, size: size) {
        return bold ? NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) : font
    }
    return NSFont(name: bold ? "Vazir-Bold" : "Vazir-Regular", size: size) ?? .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
}

final class Setup: NSObject, NSApplicationDelegate, NSWindowDelegate {
    enum Action { case install, update, check, retry, openApp, chooseApp, done }
    var window: NSWindow!
    let title = NSTextField(wrappingLabelWithString: "Checking RTL…")
    let message = NSTextField(wrappingLabelWithString: "")
    let version = NSTextField(labelWithString: "")
    let mark = BrandView()
    let activity = NSProgressIndicator()
    let progress = ProgressView()
    let install = ActionButton(title: "Checking…", target: nil, action: nil)
    var timer: Timer?
    var appPath: String?
    var runtime: String
    var hostName = "Codex"
    var supportDirectory = ""
    var statusPath: String
    var cancelPath: String
    var watching: Bool
    var busy = false
    var awaitingUninstall = false
    var phase = ""
    var nextAction = Action.check
    var lastAction = "repair"
    var expectedJobID: String?
    var jobStarted = Date()
    var missingWorkerChecks = 0
    var patchCurrent = false
    var requestedJob = false
    var fontPreferencesData: Data?
    let phaseTitles = ["starting": "Preparing RTL", "checking": "Checking for updates", "downloading-agent": "Downloading RTL", "downloading-app": "Downloading Codex", "verifying": "Verifying the update", "preparing": "Preparing RTL", "ready-to-install": "Ready to launch", "quitting": "Closing Codex", "waiting-for-quit": "Waiting for Codex", "installing": "Applying RTL", "reopening": "Opening Codex", "complete": "RTL is ready", "failed": "Could not finish", "cancelled": "Cancelled"]
    let phaseDetails = ["starting": "Codex stays open until you choose Launch.", "checking": "Finding the right update for your Codex app.", "downloading-agent": "You can keep using Codex while the update downloads.", "preparing": "Codex stays open until you choose Launch.", "ready-to-install": "Codex will restart with the new RTL panel.", "waiting-for-quit": "Finish any quit prompt in Codex.", "reopening": "Waiting for your reading controls to be ready."]

    override init() {
        let args = CommandLine.arguments
        watching = args.count >= 5 && args[1] == "--watch"
        let wizard = args.count >= 4 && args[1] == "--wizard"
        let home = ProcessInfo.processInfo.environment["ARTL_CODEX_STATE_HOME"] ?? NSHomeDirectory()
        let runtimePath = watching ? URL(fileURLWithPath: args[0]).deletingLastPathComponent().path : wizard ? args[2] : Bundle.main.resourceURL!.appendingPathComponent("runtime").path
        let configData = try? Data(contentsOf: URL(fileURLWithPath: runtimePath + "/bin/release-config.json"))
        let config = configData.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
        hostName = config["target"] as? String == "t3" ? "T3 Code" : "Codex"
        let support = home + "/Library/Application Support/" + (hostName == "T3 Code" ? "Agent RTL T3" : "Agent RTL")
        supportDirectory = support
        statusPath = watching ? args[2] : support + "/gui-status.json"; cancelPath = watching ? args[3] : support + "/gui-cancel"
        appPath = watching ? args[4] : wizard ? args[3] : nil
        expectedJobID = watching && args.count >= 6 ? args[5] : nil
        runtime = watching ? URL(fileURLWithPath: args[0]).deletingLastPathComponent().path : wizard ? args[2] : Bundle.main.resourceURL!.appendingPathComponent("runtime").path
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        for name in ["Vazir-Regular.ttf", "Vazir-Bold.ttf"] { CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: runtime + "/bin/assets/" + name) as CFURL, .process, nil) }
        refreshFont()
        refreshAppearance()
        NSApp.setActivationPolicy(.accessory)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 276), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.contentView = CanvasView(frame: NSRect(x: 0, y: 0, width: 400, height: 276))
        window.title = "Agent RTL"; window.titlebarAppearsTransparent = true; window.titleVisibility = .visible; window.backgroundColor = Palette.canvas; window.delegate = self; window.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .centerX; stack.spacing = 16; stack.detachesHiddenViews = true; stack.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -24)])
        mark.widthAnchor.constraint(equalToConstant: 56).isActive = true; mark.heightAnchor.constraint(equalToConstant: 56).isActive = true; stack.addArrangedSubview(mark)
        if let data = try? Data(contentsOf: URL(fileURLWithPath: runtime + "/package.json")), let pkg = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let current = pkg["version"] as? String { version.stringValue = "Agent RTL " + current }
        version.font = appFont(11); version.textColor = Palette.muted; version.alignment = .center
        version.setContentCompressionResistancePriority(.required, for: .vertical); stack.addArrangedSubview(version)
        title.font = appFont(22, bold: true); title.textColor = Palette.text; title.alignment = .center; title.maximumNumberOfLines = 0
        message.font = appFont(13); message.textColor = Palette.muted; message.alignment = .center; message.maximumNumberOfLines = 0; message.lineBreakMode = .byWordWrapping; message.isHidden = true; message.isSelectable = true
        let copy = NSStackView(views: [title, message]); copy.orientation = .vertical; copy.alignment = .centerX; copy.spacing = 8; copy.detachesHiddenViews = true; stack.addArrangedSubview(copy)
        copy.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        title.widthAnchor.constraint(equalTo: copy.widthAnchor).isActive = true; message.widthAnchor.constraint(equalToConstant: 320).isActive = true
        let space = NSView(); space.setContentHuggingPriority(.defaultLow, for: .vertical); space.heightAnchor.constraint(greaterThanOrEqualToConstant: 0).isActive = true; stack.addArrangedSubview(space)
        progress.heightAnchor.constraint(equalToConstant: 4).isActive = true; progress.isHidden = true; progress.setAccessibilityRole(.progressIndicator); progress.setAccessibilityLabel("Update progress")
        activity.style = .spinning; activity.controlSize = .small; activity.isDisplayedWhenStopped = false; activity.isHidden = true
        activity.widthAnchor.constraint(equalToConstant: 16).isActive = true; activity.heightAnchor.constraint(equalToConstant: 16).isActive = true; activity.setAccessibilityLabel("Working")
        install.isBordered = false; install.bezelStyle = .regularSquare; install.controlSize = .large; install.font = appFont(14, bold: true); install.heightAnchor.constraint(equalToConstant: 44).isActive = true; install.target = self; install.action = #selector(performAction); install.isEnabled = false
        let footer = NSStackView(views: [activity, progress, install]); footer.orientation = .vertical; footer.alignment = .centerX; footer.spacing = 16; footer.detachesHiddenViews = true; stack.addArrangedSubview(footer)
        for view in [progress, install] { view.widthAnchor.constraint(equalToConstant: 224).isActive = true }
        for field in [title, message] { field.baseWritingDirection = .leftToRight; field.setContentCompressionResistancePriority(.required, for: .vertical) }
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        if CommandLine.arguments.contains("--self-test") {
            let args = CommandLine.arguments
            let expected = args.firstIndex(of: "--expected-font").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } ?? "Vazir-Regular"
            window.contentView!.layoutSubtreeIfNeeded(); precondition(window.isVisible && appFont(13).fontName == expected)
            if let index = args.firstIndex(of: "--expected-theme"), args.count > index + 1 {
                precondition(NSApp.appearance?.name == (args[index + 1] == "dark" ? .darkAqua : .aqua))
                precondition(Palette.selectedAccent != nil && Palette.onAccent == NSColor.black)
            }
            if let index = args.firstIndex(of: "--expected-accent"), args.count > index + 1 {
                let hex = args[index + 1].replacingOccurrences(of: "#", with: "")
                guard let rgb = UInt32(hex, radix: 16), let actual = Palette.accent.usingColorSpace(NSColorSpace.sRGB) else { preconditionFailure("Invalid accent probe") }
                let expected = [CGFloat((rgb >> 16) & 255), CGFloat((rgb >> 8) & 255), CGFloat(rgb & 255)].map { $0 / 255 }
                precondition(zip([actual.redComponent, actual.greenComponent, actual.blueComponent], expected).allSatisfy { abs($0 - $1) < 0.005 }, "Setup accent differs from the selected panel accent")
            }
            print("Agent RTL native window started with \(appFont(13).fontName)"); DispatchQueue.main.async { NSApp.terminate(nil) }; return
        }
        if let index = CommandLine.arguments.firstIndex(of: "--preview-ui"), CommandLine.arguments.count > index + 1 {
            renderPreviews(to: CommandLine.arguments[index + 1]); NSApp.terminate(nil); return
        }
        if watching { busy = true; requestedJob = true; setButton("Cancel", action: .retry, primary: false) } else { loadPlan() }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in self.refreshFont(); self.refreshAppearance(); self.refresh() }
    }
    var appearanceData: Data?
    func refreshAppearance() {
        let data = try? Data(contentsOf: URL(fileURLWithPath: supportDirectory + "/appearance.json"))
        if data == appearanceData { return }
        appearanceData = data
        let saved = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
        let theme = saved["theme"] as? String ?? "auto"
        NSApp.appearance = theme == "dark" ? NSAppearance(named: .darkAqua) : theme == "light" ? NSAppearance(named: .aqua) : nil
        let colors: [String: UInt32] = ["#c4b5fd": 0xAD8CF3, "#b8d4f5": 0x79ADEB, "#b9dfce": 0x68C7A4, "#f3dfa8": 0xE9BF59, "#ad8cf3": 0xAD8CF3, "#79adeb": 0x79ADEB, "#68c7a4": 0x68C7A4, "#e9bf59": 0xE9BF59]
        let accent = colors[saved["accent"] as? String ?? ""] ?? 0xAD8CF3
        Palette.selectedAccent = Palette.color(accent, accent)
        window?.backgroundColor = Palette.canvas
        if let root = window?.contentView {
            func redraw(_ view: NSView) { view.needsDisplay = true; for child in view.subviews { redraw(child) } }
            redraw(root)
            install.attributedTitle = NSAttributedString(string: install.title, attributes: [.font: appFont(14, bold: true), .foregroundColor: install.primary ? Palette.onAccent : Palette.text])
        }
    }
    // Share the user's selection with the renderer without installing a macOS font.
    func refreshFont() {
        let support = URL(fileURLWithPath: supportDirectory)
        let data = try? Data(contentsOf: support.appendingPathComponent("font-preferences.json"))
        if data == fontPreferencesData { return }
        fontPreferencesData = data; customAppFont = nil
        if let data = data, let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            saved["schema"] as? Int == 1, let selected = saved["selected"] as? String,
            selected.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
            let fonts = saved["fonts"] as? [[String: Any]], let entry = fonts.first(where: { $0["id"] as? String == selected }),
            let file = entry["file"] as? String, [selected + ".ttf", selected + ".otf"].contains(file) {
            let url = support.appendingPathComponent("custom-fonts").appendingPathComponent(file)
            if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 2 * 1024 * 1024,
                let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                let descriptor = descriptors.first, let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
                if NSFont(name: name, size: 13) != nil { customAppFont = name }
            }
        }
        version.font = appFont(11); title.font = appFont(22, bold: true); message.font = appFont(13); install.font = appFont(14, bold: true); install.needsDisplay = true
        if window != nil { show(title.stringValue, message.stringValue) }
    }
    func show(_ heading: String, _ text: String = "") {
        title.stringValue = heading.replacingOccurrences(of: "Codex", with: hostName); message.stringValue = text.replacingOccurrences(of: "Codex", with: hostName); message.toolTip = text.isEmpty ? nil : message.stringValue; message.isHidden = text.isEmpty
        message.alignment = text.count > 130 ? .left : .center
        let working = ["Checking RTL…", "Checking for updates", "Preparing RTL", "Verifying the update", "Closing Codex", "Waiting for Codex", "Applying RTL", "Opening Codex"].contains(heading)
        if working && activity.isHidden { activity.isHidden = false; activity.startAnimation(nil) }
        else if !working && !activity.isHidden { activity.stopAnimation(nil); activity.isHidden = true }
        if working { progress.isHidden = true }
        // Grow for actionable details instead of truncating an error or moving the CTA into the text.
        let options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
        let titleHeight = ceil((heading as NSString).boundingRect(with: NSSize(width: 352, height: 2000), options: options, attributes: [.font: appFont(22, bold: true)]).height)
        let textHeight = text.isEmpty ? 0 : ceil((text as NSString).boundingRect(with: NSSize(width: 320, height: 2000), options: options, attributes: [.font: appFont(13)]).height) + 8
        let height = max(276, (working ? 264 : 252) + titleHeight + textHeight)
        if window?.contentView?.bounds.size != NSSize(width: 400, height: height) { window?.setContentSize(NSSize(width: 400, height: height)) }
    }
    func setButton(_ label: String, action: Action, primary: Bool = true) {
        let text = label.replacingOccurrences(of: "Codex", with: hostName)
        nextAction = action; install.title = text; install.setAccessibilityLabel(text); install.isEnabled = true; install.primary = primary
        install.attributedTitle = NSAttributedString(string: text, attributes: [.font: appFont(14, bold: true), .foregroundColor: primary ? Palette.onAccent : Palette.text]); install.keyEquivalent = "\r"
    }
    // Render the real AppKit views without RPC, installation jobs or Codex access.
    func renderPreviews(to folder: String) {
        let states: [(String, String, String, String, Double?)] = [
            ("checking", phaseTitles["checking"]!, phaseDetails["checking"]!, "Checking…", nil),
            ("available", "An RTL update is ready", "Download now. Restart Codex when you're ready.", "Download update", nil),
            ("downloading", phaseTitles["downloading-agent"]!, phaseDetails["downloading-agent"]!, "Cancel", 45),
            ("ready", phaseTitles["ready-to-install"]!, phaseDetails["ready-to-install"]!, "Launch", nil),
            ("waiting", phaseTitles["waiting-for-quit"]!, phaseDetails["waiting-for-quit"]!, "Installing…", nil),
            ("complete", "RTL is ready", "Your reading controls are ready to use.", "Open Codex", nil),
            ("unsupported", "A compatible update is needed", "No compatible release is available yet.", "Check again", nil),
            ("error", "Could not finish", "The download was interrupted. Check your connection, then try again.", "Try again", nil),
            ("long-error", "Could not finish", "Codex opened, but the new RTL panel did not confirm startup. Close and reopen Codex, then try again. If this continues, check that you are opening the same Codex installation that you selected in Agent RTL Setup.", "Try again", nil)
        ]
        do {
            try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            for (theme, name) in [("light", NSAppearance.Name.aqua), ("dark", NSAppearance.Name.darkAqua)] {
                window.appearance = NSAppearance(named: name)
                window.backgroundColor = Palette.canvas
                for (key, heading, detail, button, value) in states {
                    progress.isHidden = value == nil; progress.doubleValue = value ?? 0
                    if key == "available" { showUpdate(["release": ["agentVersion": "2.5.0", "releaseNotes": ["See your installed version in Settings.", "Read a short summary before downloading.", "Improved update feedback."]]]) } else { show(heading, detail) }; setButton(button, action: .done, primary: button != "Cancel")
                    install.isEnabled = key != "checking" && key != "waiting"
                    window.contentView!.layoutSubtreeIfNeeded(); window.displayIfNeeded()
                    let content = window.contentView!
                    for view in [mark, version, title, message, install] where !view.isHidden {
                        let rect = view.convert(view.bounds, to: content)
                        precondition(content.bounds.insetBy(dx: -1, dy: -1).contains(rect), "Preview view outside window: \(key)")
                    }
                    let actionRect = install.convert(install.bounds, to: content), copyRect = (message.isHidden ? title : message).convert((message.isHidden ? title : message).bounds, to: content)
                    precondition(install.bounds.height >= 44 && copyRect.minY >= actionRect.maxY + 16, "CTA overlaps detail text")
                    // Redraw every subview at 2x; display caches can omit unchanged controls between states.
                    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(content.bounds.width * 2), pixelsHigh: Int(content.bounds.height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw CocoaError(.fileWriteUnknown) }
                    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
                    context.cgContext.scaleBy(x: 2, y: 2); content.displayIgnoringOpacity(content.bounds, in: context)
                    NSGraphicsContext.restoreGraphicsState()
                    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
                    try png.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(theme)-\(key).png"))
                }
            }
            print("PASS: native light/dark previews, 9 states, wrapped errors, 44pt action and layout bounds; no installer jobs started.")
        } catch { fputs("Native UI preview failed: \(error.localizedDescription)\n", stderr); exit(1) }
    }
    func loadPlan() {
        show("Checking RTL…"); install.isEnabled = false; progress.isHidden = true
        rpc("status", setup: !watching) { value in
            if let current = value["installedAgentVersion"] as? String ?? value["agentVersion"] as? String { self.version.stringValue = "Agent RTL " + current }
            self.appPath = value["app"] as? String ?? self.appPath
            if value["running"] as? Bool == true, let operation = value["operation"] as? [String: Any], let id = operation["id"] as? String {
                self.busy = true; self.requestedJob = true; self.expectedJobID = id; self.refresh(); return
            }
            self.patchCurrent = value["patchCurrent"] as? Bool == true
            self.checkUpdates()

        }
    }
    func rpc(_ action: String, setup: Bool = false, completion: @escaping ([String: Any]) -> Void) {
        var arguments = [runtime + "/bin/gui-service.js", "--rpc", action]
        if let app = appPath { arguments += ["--app", app] }; if action == "install", let id = expectedJobID { arguments += ["--job", id] }; if setup { arguments += ["--setup"] }; if watching { arguments += ["--attached-ui"] }
        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process(); task.executableURL = URL(fileURLWithPath: self.runtime + "/node"); task.arguments = arguments
            task.environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("CODEX_") && $0.key != "ELECTRON_RUN_AS_NODE" }
            let pipe = Pipe(); task.standardOutput = pipe; task.standardError = Pipe()
            do {
                try task.run(); let bytes = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit(); let json = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] ?? [:]
                DispatchQueue.main.async { if json["ok"] as? Bool == true { completion(json["value"] as? [String: Any] ?? [:]) } else { self.showError(json["error"] as? String ?? "Try again.") } }
            } catch { DispatchQueue.main.async { self.showError(error.localizedDescription) } }
        }
    }
    func showUpdate(_ value: [String: Any]) {
        let release = value["release"] as? [String: Any] ?? [:]
        let target = release["agentVersion"] as? String
        let notes = (release["releaseNotes"] as? [String] ?? []).prefix(3).map { "• " + String($0.prefix(120)) }
        let detail = (["Download now. Restart Codex when you're ready."] + notes).joined(separator: "\n")
        show(target.map { "Agent RTL " + $0 + " is ready" } ?? "An RTL update is ready", detail)
    }
    func checkUpdates() {
        show(phaseTitles["checking"]!, phaseDetails["checking"]!); install.isEnabled = false
        rpc("check", setup: !watching) { value in
            if value["requiresAppUpdate"] as? Bool == true {
                self.show("Update Codex first", "Install Codex " + (value["targetVersion"] as? String ?? "") + ", then check again."); self.setButton("Check again", action: .check)
            } else if value["supported"] as? Bool != true {
                self.show("A compatible update is needed", value["releaseError"] as? String ?? "No compatible release is available yet."); self.setButton("Check again", action: .check)
            } else if value["available"] as? Bool == true {
                self.showUpdate(value); self.setButton("Download update", action: .update)
            } else if self.patchCurrent {
                self.show("RTL is up to date", "Your reading controls are ready to use."); self.setButton("Done", action: .done)
            } else {
                self.show("Update RTL", "Add reading controls to your Codex app."); self.setButton("Update RTL", action: .install)
            }

        }
    }
    @objc func performAction() {
        if busy {
            if phase == "ready-to-install" { install.isEnabled = false; rpc("install", setup: !watching) { _ in self.install.isEnabled = false } }
            else if !["quitting", "waiting-for-quit", "installing", "reopening"].contains(phase) { cancelOperation() }
            return
        }
        switch nextAction {
        case .install: begin("repair")
        case .update: begin("prepare")
        case .check: checkUpdates()
        case .retry: lastAction == "restore" ? begin("restore") : loadPlan()
        case .openApp: if let app = appPath { NSWorkspace.shared.open(URL(fileURLWithPath: app)); NSApp.terminate(nil) }
        case .chooseApp:
            let panel = NSOpenPanel(); panel.allowedContentTypes = [.applicationBundle]; panel.canChooseFiles = true; panel.canChooseDirectories = false
            if panel.runModal() == .OK, let url = panel.url { appPath = url.path; loadPlan() }
        case .done: NSApp.terminate(nil)
        }
    }
    func begin(_ action: String) {
        lastAction = action; requestedJob = true; expectedJobID = nil; jobStarted = Date(); missingWorkerChecks = 0; busy = true; phase = "starting"
        show(action == "restore" ? "Removing RTL" : "Preparing RTL"); progress.doubleValue = 0; progress.isHidden = false; setButton("Cancel", action: .retry, primary: false); install.isEnabled = false
        rpc(action, setup: !watching) { value in self.expectedJobID = value["id"] as? String; self.install.isEnabled = true }
    }
    func showError(_ text: String) {
        busy = false; phase = "failed"; progress.isHidden = true; show("Could not finish", text)
        if appPath == nil { setButton("Choose Codex…", action: .chooseApp) } else { setButton("Try again", action: .retry) }
    }
    func cancelOperation() { try? Data("cancel".utf8).write(to: URL(fileURLWithPath: cancelPath)); install.isEnabled = false }
    func refresh() {
        if awaitingUninstall && !FileManager.default.fileExists(atPath: statusPath) { timer?.invalidate(); NSApp.terminate(nil); return }
        if !busy, let data = try? Data(contentsOf: URL(fileURLWithPath: statusPath)), let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any], state["uninstall"] as? Bool == true, state["phase"] as? String == "complete", state["app"] as? String == appPath, let id = state["id"] as? String { expectedJobID = id; busy = true }
        guard busy, let expected = expectedJobID, let data = try? Data(contentsOf: URL(fileURLWithPath: statusPath)), let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any], state["id"] as? String == expected else { return }
        if let action = state["action"] as? String { lastAction = action }
        phase = state["phase"] as? String ?? ""; show(phaseTitles[phase] ?? "Updating RTL…", phaseDetails[phase] ?? "")
        if !["complete", "failed", "cancelled"].contains(phase) {
            if let pid = state["pid"] as? Int32 { if kill(pid, 0) != 0 && errno == ESRCH { missingWorkerChecks += 1 } else { missingWorkerChecks = 0 }; if missingWorkerChecks >= 3 { showError("The installer stopped. Try again."); return } }
            else if Date().timeIntervalSince(jobStarted) > 60 { showError("The installer did not start. Try again."); return }
        }
        progress.doubleValue = (state["progress"] as? Double ?? 0) * 100; progress.isHidden = !activity.isHidden || ["complete", "failed", "cancelled", "ready-to-install"].contains(phase)
        if phase == "complete" {
            if let current = state["agentVersion"] as? String { version.stringValue = "Agent RTL " + current }
            busy = false
            if state["autoClose"] as? Bool == true {
                if state["uninstall"] as? Bool == true {
                    if awaitingUninstall { busy = true; return }
                    do { let acknowledgement = try JSONSerialization.data(withJSONObject: ["id": expected, "pid": Int(getpid())]); try acknowledgement.write(to: URL(fileURLWithPath: statusPath + ".ack"), options: .atomic) }
                    catch { showError("RTL was removed, but cleanup could not finish. Try again."); return }
                    awaitingUninstall = true; busy = true; show("Finishing removal", "Removing Agent RTL settings and helper."); return
                }
                timer?.invalidate(); NSApp.terminate(nil); return
            }
            show(state["restored"] as? Bool == true ? "RTL removed" : "RTL is ready", state["autoPromptError"] == nil || state["autoPromptError"] is NSNull ? (state["restored"] as? Bool == true ? "" : "Your reading controls are ready to use.") : "The automatic update prompt could not be enabled."); setButton("Open Codex", action: .openApp)
        } else if phase == "failed" { showError(state["error"] as? String ?? "Try again.") }
        else if phase == "cancelled" { busy = false; progress.isHidden = true; setButton("Try again", action: .retry) }
        else if phase == "ready-to-install" { setButton("Launch", action: .install) }
        else { let closing = ["quitting", "waiting-for-quit", "installing", "reopening"].contains(phase); setButton(closing ? "Installing…" : "Cancel", action: .retry, primary: false); install.isEnabled = !closing }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { if awaitingUninstall { return false }; if busy && (["quitting", "waiting-for-quit", "installing", "reopening"].contains(phase) || expectedJobID == nil) { return false }; if busy { cancelOperation() }; return true }
    func windowWillClose(_ notification: Notification) { timer?.invalidate(); NSApp.terminate(nil) }
}
let delegate = Setup(); NSApplication.shared.delegate = delegate; NSApplication.shared.run()
