"""Render the restrained specular overlay for the archive's glass transport.

From the repository root:
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/glass_transport.py
  $env:NOLLE_GLASS_VARIANT='mobile'; & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/glass_transport.py; Remove-Item Env:NOLLE_GLASS_VARIANT

This is an actual rounded optical-glass solid with bevelled edges, micro-roughness,
and reflected photographic softboxes. The browser supplies the live backdrop blur;
the export carries only restrained reflected light so it cannot wash out controls.
"""

import math
import os
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "src" / "assets" / "glass"
EXPORT.mkdir(parents=True, exist_ok=True)
MOBILE = os.environ.get("NOLLE_GLASS_VARIANT") == "mobile"
MASTER = ROOT / "art" / ("glass_transport_mobile.blend" if MOBILE else "glass_transport.blend")
OUT = EXPORT / ("transport-reflection-mobile.webp" if MOBILE else "transport-reflection.webp")
RENDER = ROOT / "art" / "renders" / ("glass-transport-mobile-master.png" if MOBILE else "glass-transport-master.png")
WIDTH, HEIGHT = (900, 200) if MOBILE else (1600, 220)
FRAME_WIDTH = 7.4 if MOBILE else 12.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
RENDER.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(RENDER)

world = bpy.data.worlds.new("Dark studio environment")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.09, 0.12, 0.16, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32
scene.world = world

camera_data = bpy.data.cameras.new("Orthographic product camera")
camera = bpy.data.objects.new("Orthographic product camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 12)
camera.rotation_euler = (0, 0, 0)
camera_data.type = "ORTHO"
camera_data.ortho_scale = FRAME_WIDTH
scene.camera = camera

# A capsule 10.86 x 1.26 units, 0.11 thick, with a polished 0.065-unit bevel.
# The wide format lets the same image stretch gently on desktop and mobile.
radius = 0.63
half_length = 3.34 if MOBILE else 5.43
end_center = half_length - radius
outline = []
for i in range(65):
    a = -math.pi / 2 + math.pi * i / 64
    outline.append((end_center + radius * math.cos(a), radius * math.sin(a)))
for i in range(65):
    a = math.pi / 2 + math.pi * i / 64
    outline.append((-end_center + radius * math.cos(a), radius * math.sin(a)))
n = len(outline)
vertices = [(x, y, z) for z in (-0.055, 0.055) for x, y in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
mesh = bpy.data.meshes.new("Capsule solid geometry")
mesh.from_pydata(vertices, [], faces)
mesh.update()
solid = bpy.data.objects.new("Polished optical glass capsule", mesh)
scene.collection.objects.link(solid)
bevel = solid.modifiers.new("Soft optical edge", "BEVEL")
bevel.width = 0.065
bevel.segments = 8
bevel.affect = "EDGES"
solid.modifiers.new("Weighted edge normals", "WEIGHTED_NORMAL")
for polygon in mesh.polygons:
    polygon.use_smooth = True

glass = bpy.data.materials.new("Clear low-iron glass, IOR 1.47")
glass.use_nodes = True
bsdf = glass.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.89, 0.95, 1.0, 1)
bsdf.inputs["Roughness"].default_value = 0.055
bsdf.inputs["IOR"].default_value = 1.47
bsdf.inputs["Transmission Weight"].default_value = 0.96
nodes, links = glass.node_tree.nodes, glass.node_tree.links
micro = nodes.new("ShaderNodeTexNoise")
micro.label = "Subtle rolled-glass imperfection"
micro.inputs["Scale"].default_value = 220
micro.inputs["Detail"].default_value = 2
micro.inputs["Roughness"].default_value = 0.7
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.045
bump.inputs["Distance"].default_value = 0.0014
links.new(micro.outputs["Fac"], bump.inputs["Height"])
links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
solid.data.materials.append(glass)


def softbox(name, position, power, color, width, height, rotation):
    data = bpy.data.lights.new(name, "AREA")
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = rotation
    data.shape = "RECTANGLE"
    data.size = width
    data.size_y = height
    data.energy = power
    data.color = color


# Narrow cards create the familiar broken glints on bevelled optical glass.
softbox("Long pearl reflection", (-1.6, 0.75, 2.7), 420, (0.82, 0.9, 1), 6.9, 0.3, (0.25, -0.18, -0.07))
softbox("Warm near edge", (3.2, -1.35, 2.1), 310, (1.0, 0.88, 0.72), 4.2, 0.21, (-0.25, 0.16, 0.11))
softbox("Cool corner flash", (-3.1 if MOBILE else -5.2, 0.15, 1.35), 150, (0.7, 0.82, 1), 0.28, 1.45, (0.05, -0.14, 0.22))
softbox("Broad photographic fill", (0, 1.5, 4.5), 125, (0.92, 0.95, 1), 8.0, 1.1, (0.22, 0, 0))

bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))
bpy.ops.render.render(write_still=True)

# Convert the reflected-light result to a sparse overlay. Keeping the panel
# itself almost transparent avoids cloudy glass and preserves all label contrast.
# Pixel values are Blender's rendered reflections; the cap keeps them subtle.
result = bpy.data.images.load(str(RENDER), check_existing=False)
pixels = [0.0] * (WIDTH * HEIGHT * 4)
result.pixels.foreach_get(pixels)
out_pixels = [0.0] * len(pixels)
for y in range(HEIGHT):
    wy = ((y + 0.5) / HEIGHT - 0.5) * (FRAME_WIDTH * HEIGHT / WIDTH)
    for x in range(WIDTH):
        i = (y * WIDTH + x) * 4
        r, g, b, a = pixels[i:i + 4]
        if a < 0.002:
            continue
        # The modeled bevel supplies the strong rim; the almost invisible
        # interior sheen is just enough to read as optical glass in motion.
        wx = ((x + 0.5) / WIDTH - 0.5) * FRAME_WIDTH
        dx = max(0.0, abs(wx) - end_center)
        distance_from_edge = radius - math.hypot(dx, wy)
        rim = math.exp(-((distance_from_edge / 0.09) ** 2))
        shoulder = math.exp(-((max(distance_from_edge, 0.0) / 0.20) ** 2))
        luminance = max(0.0, 0.22 * r + 0.68 * g + 0.10 * b)
        reflection = min(0.19, max(0.0, luminance - 0.20) * 0.24)
        alpha = min(0.16, a * (0.002 + 0.025 * rim) + reflection * (0.78 * rim + 0.10 * shoulder))
        out_pixels[i:i + 4] = (0.88 + 0.12 * min(r, 1), 0.92 + 0.08 * min(g, 1), 1.0, alpha)

image = bpy.data.images.new("Sparse specular light overlay", width=WIDTH, height=HEIGHT, alpha=True)
image.pixels.foreach_set(out_pixels)
image.filepath_raw = str(OUT)
image.file_format = "WEBP"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 98
image.save()
print(f"Saved editable scene: {MASTER}")
print(f"Saved transparent transport reflection: {OUT} ({WIDTH}x{HEIGHT})")
