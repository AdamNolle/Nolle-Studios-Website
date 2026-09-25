"""Render a sparse optical reflection for the floating photo transport.

From the repository root, render both rail proportions:
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/glass_transport.py
  $env:NOLLE_GLASS_VARIANT='mobile'; & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/glass_transport.py; Remove-Item Env:NOLLE_GLASS_VARIANT

The actual rail is live CSS glass. This physically modeled, lit solid contributes
only reflected light. Its interior stays transparent so the page can show through.
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

# Two device pixels for each CSS pixel. The desktop master fits a 1040 x 72
# rail; the mobile master fits a 350 x 72 rail and may stretch modestly.
WIDTH, HEIGHT = (700, 144) if MOBILE else (2080, 144)
FRAME_WIDTH = 7.0 if MOBILE else 12.0
FRAME_HEIGHT = FRAME_WIDTH * HEIGHT / WIDTH
HALF_WIDTH = FRAME_WIDTH / 2 - 0.012
HALF_HEIGHT = FRAME_HEIGHT / 2 - 0.012
CORNER_RADIUS = FRAME_WIDTH * 23 / (WIDTH / 2)


def softbox(name, position, power, color, width, height, rotation):
    data = bpy.data.lights.new(name, "AREA")
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = rotation
    data.shape = "RECTANGLE"
    data.size = width
    data.size_y = height
    data.energy = power
    data.color = color
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 80
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

world = bpy.data.worlds.new("Charcoal photographic studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.075, 0.10, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.20
scene.world = world

camera_data = bpy.data.cameras.new("Front-on orthographic product camera")
camera = bpy.data.objects.new("Front-on orthographic product camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 12)
camera_data.type = "ORTHO"
camera_data.ortho_scale = FRAME_WIDTH
scene.camera = camera

# The desktop rail is a long rounded rectangle, not a pill. The 23px corner
# radius is modeled at the same scale as its rendered CSS counterpart.
corners = (
    (HALF_WIDTH - CORNER_RADIUS, HALF_HEIGHT - CORNER_RADIUS, 0),
    (-HALF_WIDTH + CORNER_RADIUS, HALF_HEIGHT - CORNER_RADIUS, 90),
    (-HALF_WIDTH + CORNER_RADIUS, -HALF_HEIGHT + CORNER_RADIUS, 180),
    (HALF_WIDTH - CORNER_RADIUS, -HALF_HEIGHT + CORNER_RADIUS, 270),
)
outline = []
for cx, cy, start in corners:
    for step in range(17):
        angle = math.radians(start + 90 * step / 16)
        outline.append((cx + CORNER_RADIUS * math.cos(angle), cy + CORNER_RADIUS * math.sin(angle)))

n = len(outline)
vertices = [(x, y, z) for z in (-0.045, 0.045) for x, y in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
mesh = bpy.data.meshes.new("Rounded glass rail geometry")
mesh.from_pydata(vertices, [], faces)
mesh.update()
solid = bpy.data.objects.new("Polished low-iron glass rail", mesh)
scene.collection.objects.link(solid)
bevel = solid.modifiers.new("Fine optical edge", "BEVEL")
bevel.width = 0.032
bevel.segments = 8
bevel.affect = "EDGES"
solid.modifiers.new("Weighted edge normals", "WEIGHTED_NORMAL")
for polygon in mesh.polygons:
    polygon.use_smooth = True

glass = bpy.data.materials.new("Clear glass, IOR 1.47")
glass.use_nodes = True
bsdf = glass.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.90, 0.96, 1.0, 1)
bsdf.inputs["Roughness"].default_value = 0.042
bsdf.inputs["IOR"].default_value = 1.47
bsdf.inputs["Transmission Weight"].default_value = 0.98
nodes, links = glass.node_tree.nodes, glass.node_tree.links
micro = nodes.new("ShaderNodeTexNoise")
micro.label = "Optical surface irregularity"
micro.inputs["Scale"].default_value = 260
micro.inputs["Detail"].default_value = 2
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.025
bump.inputs["Distance"].default_value = 0.0007
links.new(micro.outputs["Fac"], bump.inputs["Height"])
links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
solid.data.materials.append(glass)

# Large angled photographic cards give the material continuous, asymmetric
# specular strips, while narrow cards catch the precision-machined edge.
softbox("Cool upper sweep", (-1.7, 0.9, 2.7), 350, (0.77, 0.89, 1.0), 5.8, 0.20, (0.22, -0.18, -0.075))
softbox("Pearl top card", (2.4, 1.2, 2.3), 290, (0.96, 0.97, 1.0), 3.5, 0.13, (0.30, 0.15, 0.04))
softbox("Warm lower glint", (2.2, -0.95, 2.1), 225, (1.0, 0.90, 0.79), 4.3, 0.12, (-0.20, 0.11, 0.06))
softbox("Left optical edge", (-3.35 if MOBILE else -5.75, 0.10, 1.45), 110, (0.77, 0.86, 1.0), 0.22, 0.78, (0.03, -0.13, 0.20))
softbox("Quiet fill", (0, 1.6, 5.0), 70, (0.92, 0.97, 1.0), 8.0, 1.0, (0.21, 0, 0))

bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))
bpy.ops.render.render(write_still=True)

# Export reflected light only. The rendered glass body's gray studio fill is
# removed mathematically. Genuine glints on the modeled bevel remain, but the
# center's alpha is effectively zero and cannot muddy the real cork backdrop.
result = bpy.data.images.load(str(RENDER), check_existing=False)
pixels = [0.0] * (WIDTH * HEIGHT * 4)
result.pixels.foreach_get(pixels)
out_pixels = [0.0] * len(pixels)
for y in range(HEIGHT):
    wy = ((y + 0.5) / HEIGHT - 0.5) * FRAME_HEIGHT
    for x in range(WIDTH):
        i = (y * WIDTH + x) * 4
        r, g, b, a = pixels[i:i + 4]
        if a < 0.002:
            continue
        wx = ((x + 0.5) / WIDTH - 0.5) * FRAME_WIDTH
        qx = abs(wx) - (HALF_WIDTH - CORNER_RADIUS)
        qy = abs(wy) - (HALF_HEIGHT - CORNER_RADIUS)
        outside = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - CORNER_RADIUS
        depth = max(0.0, -outside)
        rim = math.exp(-((depth / 0.028) ** 2))
        shoulder = math.exp(-((max(depth - 0.025, 0.0) / 0.09) ** 2))
        luminance = max(0.0, 0.22 * r + 0.68 * g + 0.10 * b)
        reflection = min(1.0, max(0.0, (luminance - 0.055) / 0.48))
        alpha = min(0.32, a * (0.004 + 0.035 * rim + reflection * (0.30 * rim + 0.055 * shoulder)))
        out_pixels[i:i + 4] = (0.83 + 0.17 * min(r, 1), 0.90 + 0.10 * min(g, 1), 1.0, alpha)

image = bpy.data.images.new("Sparse glass reflection with true alpha", width=WIDTH, height=HEIGHT, alpha=True)
image.pixels.foreach_set(out_pixels)
image.filepath_raw = str(OUT)
image.file_format = "WEBP"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 98
image.save()
print(f"Saved editable scene: {MASTER}")
print(f"Saved transparent reflection: {OUT} ({WIDTH}x{HEIGHT})")
