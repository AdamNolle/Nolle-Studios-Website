"""Render the liquid-glass rim shared by every bar and panel on the light table.

From the repository root (Blender 5.2, Cycles on the GPU):
  blender -b -P art/liquid_glass.py
  blender -b -P art/liquid_glass.py -- samples=256

The browser supplies the tinted body and backdrop blur. This image holds only
the light reflected by a thick, pillowed slab of glass: a bright upper rim, a
quieter lower rim, a cool sheen in the upper-left corner, and a warm glint in
the lower-right. It is exported as a nine-slice master. CSS stretches the edge
slices and keeps the corners square-scaled, so one file fits the header,
transport, hints and panels at any size and any corner radius.
"""

import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import use_gpu  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "art" / "liquid_glass.blend"
RENDER = ROOT / "art" / "renders" / "liquid-glass-master.png"
OUT = ROOT / "src" / "assets" / "glass" / "liquid-glass.webp"

# 1024 px square, 96 px corner radius, sliced 160 px in from each edge.
# CSS: border-image-slice 160, border-image-width = radius * 160 / 96.
SIZE = 1024
FRAME = 8.0
PX = SIZE / FRAME
RADIUS = 96 / PX
HALF = FRAME / 2 - 0.02
SHOULDER = 34 / PX


def option(name, default):
    for arg in sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []:
        key, _, value = arg.partition("=")
        if key == name:
            return type(default)(value)
    return default


def softbox(name, location, rotation, power, color, size, size_y, shape="RECTANGLE"):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = shape
    data.size = size
    data.size_y = size_y
    data.energy = power
    data.color = color
    light = bpy.data.objects.new(name, data)
    light.location = location
    light.rotation_euler = [math.radians(a) for a in rotation]
    bpy.context.collection.objects.link(light)
    return light


def rounded_outline(half, radius, steps=24):
    points = []
    for cx, cy, start in ((half - radius, half - radius, 0), (-half + radius, half - radius, 90),
                          (-half + radius, -half + radius, 180), (half - radius, -half + radius, 270)):
        for step in range(steps + 1):
            angle = math.radians(start + 90 * step / steps)
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
use_gpu(scene)
scene.cycles.samples = option("samples", 128)
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 16
scene.cycles.transmission_bounces = 16
scene.cycles.glossy_bounces = 8
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.cycles.film_transparent_glass = True
scene.view_settings.view_transform = "Standard"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "16"
RENDER.parent.mkdir(parents=True, exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(RENDER)

# Blender's bundled CC0 studio HDRI gives the rim real, uneven reflections
# instead of the even stroke that made the glass read as an outline.
HDRI = sorted(Path(bpy.app.binary_path).parent.parent.glob("Resources/*/datafiles/studiolights/world/studio.exr"))
world = bpy.data.worlds.new("Studio")
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
background = wn["Background"]
background.inputs["Strength"].default_value = option("hdri", 0.55)
if HDRI:
    environment = wn.new("ShaderNodeTexEnvironment")
    environment.image = bpy.data.images.load(str(HDRI[0]))
    mapping = wn.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, 0, math.radians(option("turn", 140.0)))
    wl.new(wn.new("ShaderNodeTexCoord").outputs["Generated"], mapping.inputs["Vector"])
    wl.new(mapping.outputs["Vector"], environment.inputs["Vector"])
    wl.new(environment.outputs["Color"], background.inputs["Color"])
else:
    background.inputs["Color"].default_value = (0.03, 0.035, 0.045, 1)
scene.world = world

camera_data = bpy.data.cameras.new("Orthographic front camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = FRAME
camera = bpy.data.objects.new("Orthographic front camera", camera_data)
camera.location = (0, 0, 12)
scene.collection.objects.link(camera)
scene.camera = camera

# A thick slab whose rounded shoulder is the "liquid" edge that catches light.
outline = rounded_outline(HALF, RADIUS)
n = len(outline)
vertices = [(x, y, z) for z in (-0.16, 0.16) for x, y in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
mesh = bpy.data.meshes.new("Liquid glass slab")
mesh.from_pydata(vertices, [], faces)
mesh.update()
slab = bpy.data.objects.new("Liquid glass slab", mesh)
scene.collection.objects.link(slab)
bevel = slab.modifiers.new("Pillowed shoulder", "BEVEL")
bevel.width = SHOULDER
bevel.segments = 14
bevel.profile = 0.62
bevel.limit_method = "ANGLE"
slab.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
for polygon in mesh.polygons:
    polygon.use_smooth = True

glass = bpy.data.materials.new("Low-iron glass, IOR 1.5")
glass.use_nodes = True
bsdf = glass.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.94, 0.97, 1.0, 1)
bsdf.inputs["Roughness"].default_value = 0.12
bsdf.inputs["IOR"].default_value = 1.5
bsdf.inputs["Transmission Weight"].default_value = 1.0
slab.data.materials.append(glass)

# One lamp above and to the upper left, as over the table: the upper-left
# shoulder catches a bright specular line and the lower-right a faint echo.
GAIN = option("gain", 1.0)
rims = [
    softbox("Table lamp", (-6, 8, 5.0), (-58, -38, 0), 9000 * GAIN, (1.0, 0.97, 0.92), 40, 5),
    softbox("Bounce from the cork", (5, -7, 1.6), (78, 30, 0), 1400 * GAIN, (1.0, 0.86, 0.7), 40, 4),
]
bpy.ops.wm.save_as_mainfile(filepath=str(MASTER))


def render(visible, path):
    for light in rims:
        light.hide_render = light not in visible
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path), check_existing=False)
    pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(SIZE, SIZE, 4)
    rgb = np.clip(pixels[..., :3], 0, 1)
    luminance = 0.24 * rgb[..., 0] + 0.66 * rgb[..., 1] + 0.10 * rgb[..., 2]
    return rgb, pixels[..., 3], np.clip((luminance - 0.02) / 0.4, 0, 1) ** 0.9


rim_rgb, coverage, rim = render(rims, RENDER)


def fade(v, start=60.0, end=150.0):
    t = np.clip((v - start) / (end - start), 0, 1)
    return 1 - t * t * (3 - 2 * t)


# Distance inside the rounded rectangle, in pixels, from its outer edge.
# Blender stores rows bottom-up, so row 0 is the lower edge.
axis = (np.arange(SIZE) + 0.5) / PX - FRAME / 2
qx = np.abs(axis)[None, :] - (HALF - RADIUS)
qy = np.abs(axis)[:, None] - (HALF - RADIUS)
outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - RADIUS
depth = np.maximum(-outside, 0) * PX

# Only the curved shoulder keeps its reflections; the flat face would
# otherwise mirror the whole room as a frosted frame. That also keeps every
# highlight well inside the slice band, so stretched edges never smear. No
# stroke is added: the edge is only as bright as the light it reflects.
light = rim * fade(depth, 12, 34)
alpha = np.clip(coverage * 0.9 * light, 0, 0.9)
out = np.empty((SIZE, SIZE, 4), dtype=np.float32)
out[..., 0] = 0.9 + 0.1 * rim_rgb[..., 0]
out[..., 1] = 0.92 + 0.08 * rim_rgb[..., 1]
out[..., 2] = 0.94 + 0.06 * rim_rgb[..., 2]
out[..., 3] = alpha

image = bpy.data.images.new("Liquid glass nine-slice", width=SIZE, height=SIZE, alpha=True)
image.pixels.foreach_set(out.ravel())
image.filepath_raw = str(OUT)
image.file_format = "WEBP"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 94
image.save()
print(f"Saved editable scene: {MASTER}")
print(f"Saved nine-slice glass: {OUT} ({SIZE}x{SIZE}, slice 160, radius 96)")


# ---- Refraction map -----------------------------------------------------
# The same outline cut from a thick block with a deep, round shoulder. Its
# surface normals say which way light bends at each point: R and G hold the
# normal's x and y in screen directions (y down), 0.5 is flat. The site
# nine-slices this map to each bar's size and feeds it to an SVG
# feDisplacementMap, so the backdrop bends at the rim like a real lens.
NORMAL_OUT = OUT.with_name("liquid-glass-normal.png")
LENS = 88 / PX
vertices = [(x, y, z) for z in (-1.2, 1.2) for x, y in outline]
lens_mesh = bpy.data.meshes.new("Refraction lens")
lens_mesh.from_pydata(vertices, [], faces)
lens_mesh.update()
lens = bpy.data.objects.new("Refraction lens", lens_mesh)
scene.collection.objects.link(lens)
lens_bevel = lens.modifiers.new("Round shoulder", "BEVEL")
lens_bevel.width = LENS
lens_bevel.segments = 32
lens_bevel.profile = 0.5
lens_bevel.limit_method = "ANGLE"
for polygon in lens_mesh.polygons:
    polygon.use_smooth = True
encode = bpy.data.materials.new("Normal as colour")
encode.use_nodes = True
en, el = encode.node_tree.nodes, encode.node_tree.links
en.clear()
geometry = en.new("ShaderNodeNewGeometry")
flip = en.new("ShaderNodeVectorMath")
flip.operation = "MULTIPLY_ADD"
flip.inputs[1].default_value = (0.5, -0.5, 0.0)
flip.inputs[2].default_value = (0.5, 0.5, 0.5)
emission = en.new("ShaderNodeEmission")
output = en.new("ShaderNodeOutputMaterial")
el.new(geometry.outputs["Normal"], flip.inputs[0])
el.new(flip.outputs["Vector"], emission.inputs["Color"])
el.new(emission.outputs["Emission"], output.inputs["Surface"])
lens.data.materials.append(encode)
slab.hide_render = True
for light in rims:
    light.hide_render = True
scene.view_settings.view_transform = "Raw"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"
scene.cycles.use_denoising = False
scene.cycles.samples = 16
lens.location.z = -1.2 + 0.16
scene.render.filepath = str(RENDER.with_name("liquid-glass-normal-render.png"))
bpy.ops.render.render(write_still=True)
raw = bpy.data.images.load(scene.render.filepath, check_existing=False)
raw.colorspace_settings.name = "Non-Color"
pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
raw.pixels.foreach_get(pixels)
pixels = pixels.reshape(SIZE, SIZE, 4)
covered = pixels[..., 3:4]
normal = np.empty_like(pixels)
normal[..., :3] = pixels[..., :3] * covered + 0.5 * (1 - covered)
normal[..., 2] = 0.5
normal[..., 3] = 1.0
flat = bpy.data.images.new("Refraction map", width=SIZE, height=SIZE, alpha=False)
flat.colorspace_settings.name = "Non-Color"
flat.pixels.foreach_set(normal.ravel())
flat.scale(SIZE // 2, SIZE // 2)
flat.filepath_raw = str(NORMAL_OUT)
flat.file_format = "PNG"
flat.save()
print(f"Saved refraction map: {NORMAL_OUT} ({SIZE // 2}x{SIZE // 2}, slice 80, radius 48)")
