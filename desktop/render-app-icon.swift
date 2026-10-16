import AppKit
import Foundation

// Converts the supplied artwork into a proper macOS application icon. macOS
// expects a square source image and applies its own Dock treatment, so the
// artwork is placed inside a softly rounded square without stretching it.
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: render-app-icon <source.png> <output.png>\n", stderr)
    exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let source = NSImage(contentsOf: sourceURL) else {
    fputs("Could not read source icon: \(sourceURL.path)\n", stderr)
    exit(1)
}

let canvasSize = NSSize(width: 1024, height: 1024)
let canvas = NSImage(size: canvasSize)
canvas.lockFocus()

// Leave a transparent margin around the rounded tile. This prevents macOS from
// making the icon look larger than neighboring Dock icons.
let tileRect = NSRect(x: 38, y: 38, width: 948, height: 948)
let tilePath = NSBezierPath(roundedRect: tileRect, xRadius: 205, yRadius: 205)
NSColor(calibratedRed: 0.93, green: 0.95, blue: 0.94, alpha: 1).setFill()
tilePath.fill()

// The supplied artwork can be landscape or portrait. Fit it into a generous
// square safe area so the full logo remains visible and undistorted.
let artworkBounds = NSRect(x: 92, y: 92, width: 840, height: 840)
let scale = min(
    artworkBounds.width / source.size.width,
    artworkBounds.height / source.size.height
)
let artworkSize = NSSize(
    width: source.size.width * scale,
    height: source.size.height * scale
)
let artworkRect = NSRect(
    x: artworkBounds.midX - artworkSize.width / 2,
    y: artworkBounds.midY - artworkSize.height / 2,
    width: artworkSize.width,
    height: artworkSize.height
)
NSGraphicsContext.saveGraphicsState()
NSBezierPath(roundedRect: artworkBounds, xRadius: 118, yRadius: 118).addClip()
source.draw(
    in: artworkRect,
    from: NSRect(origin: .zero, size: source.size),
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
)
NSGraphicsContext.restoreGraphicsState()

// A subtle outline keeps the icon crisp against both light and dark Docks.
NSColor(calibratedWhite: 0.72, alpha: 0.35).setStroke()
tilePath.lineWidth = 3
tilePath.stroke()
canvas.unlockFocus()

guard
    let tiff = canvas.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fputs("Could not encode the rendered icon.\n", stderr)
    exit(1)
}

try png.write(to: outputURL, options: .atomic)
