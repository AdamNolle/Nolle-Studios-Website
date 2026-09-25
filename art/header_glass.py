"""Render restrained optical reflections for the light-table header.

From the repository root:
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/header_glass.py
  $env:NOLLE_HEADER_VARIANT='mobile'
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' -b -P art/header_glass.py
  Remove-Item Env:NOLLE_HEADER_VARIANT

The live CSS supplies the dark body and backdrop blur. These RGBA images contain
only the light reflected by a modeled, beveled piece of optical glass.
"""

import math
import os
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "src" / "assets" / "glass"
EXPORT.mkdir(parents=True, exist_ok=True)
MOBILE = os.environ.get("NOLLE_HEADER_VARIANT") == "mobile"
WIDTH, HEIGHT = (760, 144) if MOBILE else (2048, 144)
SLAB_WIDTH = 8.0 if MOBILE else 14.0
SLAB_HEIGHT = SLAB_WIDTH * HEIGHT / WIDTH
CORNER_PX = 4 if MOBILE else 15
RADIUS = SLAB_WIDTH * (CORNER_PX / (WIDTH / 2))
HALF_W = SLAB_WIDTH / 2 - 0.012
HALF_H = SLAB_HEIGHT / 2 - 0.012
VARIANT = "-mobile" if MOBILE else ""
MASTER = ROOT / "art" / f"header_glass{VARIANT}.blend"
RENDER = ROOT / "art" / "renders" / f"header-glass{VARIANT}-master.png"
OUT = EXPORT / f"header-reflection{VARIANT}.webp"
RENDER.parent.mkdir(parents=True, exist_ok=True)


def softbox(name, position, power, color, width, height, rotation):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "RECTANGLE"
    data.size = width
    data.size_y = height
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = position
    light.rotation_euler = rotation
    return light


def rounded_outline(half_w, half_h, radius):
    corners = (
        (half_w - radius, half_h - radius, 0),
        (-half_w + radius, half_h - radius, 90),
        (-half_w + radius, -half_h + radius, 180),
        (half_w - radius, -half_h + radius, 270),
    )
    return [
        (
            cx + radius * math.cos(math.radians(start + step * 90 / 16)),
            cy + radius * math.sin(math.radians(start + step * 90 / 16)),
        )
        for cx, cy, start in corners
        for step in range(17)
    ]


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
scene.render.filepath = str(RENDER)

world = bpy.data.worlds.new("Black photographic studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.014, 0.019, 0.027, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12
scene.world = world

camera_data = bpy.data.cameras.new("Orthographic optical study")
camera = bpy.data.objects.new("Orthographic optical study", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 12)
camera_data.type = "ORTHO"
camera_data.ortho_scale = SLAB_WIDTH
scene.camera = camera

outline = rounded_outline(HALF_W, HALF_H, RADIUS)
n = len(outline)
vertices = [(x, y, z) for z in (-0.045, 0.045) for x, y in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
mesh = bpy.data.meshes.new("Rounded low-iron glass body")
mesh.from_pydata(vertices, [], faces)
mesh.update()
slab = bpy.data.objects.new("Machined optical header glass", mesh)
scene.collection.objects.link(slab)
bevel = slab.modifiers.new("Polished optical edge", "BEVEL")
bevel.width = 0.022 if MOBILE else 0.027
bevel.segments = 8
bevel.affect = "EDGES"
slab.modifiers.new("Weighted edge normals", "WEIGHTED_NORMAL")
for polygon in mesh.polygons:
    polygon.use_smooth = True

glass = bpy.data.materials.new("Low-iron cast optical glass, IOR 1.47")
glass.use_nodes = True
bsdf = glass.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.86, 0.94, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.048
bsdf.inputs["IOR"].default_value = 1.47
bsdf.inputs["Transmission Weight"].default_value = 0.985
noise = glass.node_tree.nodes.new("ShaderNodeTexNoise")
noise.label = "Sub-visible polish variation"
noise.inputs["Scale"].default_value = 300
noise.inputs["Detail"].default_value = 2
bump = glass.node_tree.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.008
bump.inputs["Distance"].default_value = 0.0003
glass.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
glass.node_tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
slab.data.materials.append(glass)

# Broad studio cards generate a shaped top-edge highlight; the narrow vertical
# card yields a signature reflected streak. No painted gradient is baked in.
softbox("Pearl upper lip", (-1.0, 0.89, 2.5), 310, (0.88, 0.94, 1.0), 7.0, 0.09, (0.25, -0.08, -0.035))
softbox("Cool long reflection", (3.0, 1.3, 2.4), 250, (0.73, 0.86, 1.0), 4.2, 0.16, (0.25, 0.16, 0.08))
softbox("Warm lower card", (-3.4, -1.0, 2.1), 155, (1.0, 0.87, 0.72), 5.1, 0.08, (-0.18, 0.08, -0.06))
softbox("Precise left facet", (-HALF_W + 0.16, 0.18, 1.2), 125, (0.78, 0.89, 1.0), 0.15, 0.92, (0.05, -0.14, 0.04))
softbox("Small right edge", (HALF_W - 0.36, -0.1, 1.4), 85, (0.90, 0.96, 1.0), 0.17, 0.75, (0.06, 0.10, -0.03))

bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))
bpy.ops.render.render(write_still=True)

# An isolated render of transmissive glass has a faint opaque body. Remove it
# while retaining observed highlights on the bevel and studio-card reflections.
result = bpy.data.images.load(str(RENDER), check_existing=False)
source = [0.0] * (WIDTH * HEIGHT * 4)
result.pixels.foreach_get(source)
output = [0.0] * len(source)
for y in range(HEIGHT):
    wy = ((y + 0.5) / HEIGHT - 0.5) * SLAB_HEIGHT
    for x in range(WIDTH):
        i = (y * WIDTH + x) * 4
        r, g, b, a = source[i:i + 4]
        if a < 0.002:
            continue
        wx = ((x + 0.5) / WIDTH - 0.5) * SLAB_WIDTH
        qx = abs(wx) - (HALF_W - RADIUS)
        qy = abs(wy) - (HALF_H - RADIUS)
        outside = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - RADIUS
        depth = max(0.0, -outside)
        rim = math.exp(-((depth / 0.034) ** 2))
        shoulder = math.exp(-((max(depth - 0.015, 0.0) / 0.11) ** 2))
        luminance = 0.23 * r + 0.68 * g + 0.09 * b
        reflection = min(1.0, max(0.0, (luminance - 0.20) / 0.53))
        # Preserve the nearly empty center while making the physically rendered
        # perimeter/card glints visible above the live cork and dark CSS glass.
        glint = 0.045 * rim + reflection * (0.20 * rim + 0.045 * shoulder)
        alpha = min(0.42, a * (0.001 + glint * (3.4 if MOBILE else 2.3)))
        output[i:i + 4] = (0.84 + 0.16 * min(r, 1), 0.91 + 0.09 * min(g, 1), 1.0, alpha)

image = bpy.data.images.new("Optical header reflection with true alpha", width=WIDTH, height=HEIGHT, alpha=True)
image.pixels.foreach_set(output)
image.filepath_raw = str(OUT)
image.file_format = "WEBP"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 98
image.save()
print(f"Saved editable Blender scene: {MASTER}")
print(f"Saved transparent header reflection: {OUT} ({WIDTH}x{HEIGHT})")
