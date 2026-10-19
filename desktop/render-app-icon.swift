import AppKit
import Foundation

// Preserve the supplied artwork and transparency, with a small Dock margin.
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

// Allocate explicit pixels so Retina displays do not change the output size.
guard
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: 1024,
        pixelsHigh: 1024,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ),
    let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
    fputs("Could not create the icon canvas.\n", stderr)
    exit(1)
}

let canvasRect = NSRect(x: 0, y: 0, width: 1024, height: 1024)
let artworkBounds = canvasRect.insetBy(dx: 38, dy: 38)
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
NSGraphicsContext.current = context
context.cgContext.clear(canvasRect)
source.draw(
    in: artworkRect,
    from: NSRect(origin: .zero, size: source.size),
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Could not encode the rendered icon.\n", stderr)
    exit(1)
}

try png.write(to: outputURL, options: .atomic)
