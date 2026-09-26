"""Render the studio's four-square mark as four tiles of coloured glass.

Blender 5.2 (Cycles on the GPU):
  blender -b -P art/glass_mark.py
  blender -b -P art/glass_mark.py -- samples=512

Black, blue, green and red tiles, each a slab of glass with a rounded
shoulder, fused into the mark's rounded square with hairline seams that
show the header behind. Each tile emits exactly the flat mark's colour, so
the glass never dulls it; a clear coat on top reflects Blender's CC0 studio
HDRI and the lamp that lights the header's rim, with a soft sheen in each
tile's upper-left corner and a deeper tone along the shoulder. The
background renders transparent.

Writes src/assets/glass/mark.webp (160 x 160, shown at 38 px).
"""

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Nodes, args, reset, srgb, use_gpu  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / "art" / "renders" / "mark-glass.png"
OUT = ROOT / "src" / "assets" / "glass" / "mark.webp"
HDRI = sorted(Path(bpy.app.binary_path).parent.parent.glob("Resources/*/datafiles/studiolights/world/studio.exr"))

# The mark is a 16 x 16 square in millimetres; its corners match the header
# button's 7 px radius at 38 px.
SIZE, GAP, THICK = 16.0, 0.28, 3.2
OUTER, INNER, SHOULDER = 2.9, 0.55, 1.15
TILES = [  # (x, y) quadrant, the flat mark's colour
    ((-1, 1), "#000000"),
    ((1, 1), "#2A35FF"),
    ((-1, -1), "#5EF50D"),
    ((1, -1), "#FF1818"),
]


def outline(x0, y0, x1, y1, radii, steps=14):
    """Counter-clockwise rounded rectangle, one radius per corner (tl, tr, br, bl)."""
    tl, tr, br, bl = radii
    corners = [(x1 - tr, y1 - tr, tr, 0), (x0 + tl, y1 - tl, tl, 90), (x0 + bl, y0 + bl, bl, 180), (x1 - br, y0 + br, br, 270)]
    points = []
    for cx, cy, r, start in corners:
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return points


def tile(name, quadrant, colour):
    qx, qy = quadrant
    half = SIZE / 2
    x0, x1 = (-half, -GAP / 2) if qx < 0 else (GAP / 2, half)
    y0, y1 = (-half, -GAP / 2) if qy < 0 else (GAP / 2, half)
    # The mark's outer corner is round; the three that meet the others are nearly square.
    outer = {(-1, 1): 0, (1, 1): 1, (1, -1): 2, (-1, -1): 3}[quadrant]
    radii = [INNER] * 4
    radii[outer] = OUTER
    ring = outline(x0, y0, x1, y1, radii)
    n = len(ring)
    verts = [(x, y, z) for z in (0.0, THICK) for x, y in ring]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bevel = obj.modifiers.new("Rounded shoulder", "BEVEL")
    bevel.width = SHOULDER
    bevel.segments = 10
    bevel.profile = 0.6
    bevel.limit_method = "ANGLE"
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    # The colour is emitted at exactly the brand's sRGB value, so lighting can
    # never dull it. On top sits a clear coat that only adds reflections: the
    # room, the lamp along the shoulder, and a soft sheen in the upper-left.
    mat = bpy.data.materials.new(f"{name} glass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    n = Nodes(nt)
    generated = n.add("SeparateXYZ", inputs=[n.add("TexCoord").outputs["Generated"]])
    corner = n.math("ADD", generated.outputs[0], n.math("SUBTRACT", 1.0, generated.outputs[1]))
    sheen = n.math("POWER", n.math("SUBTRACT", 1.0, n.math("MULTIPLY", corner, 0.95), clamp=True), 2.0)
    tint = n.mix(n.math("MULTIPLY", sheen, 0.2), (*srgb(colour), 1), (1, 1, 1, 1))
    # Glass looks deeper where you see through more of it: the shoulder.
    facing = n.add("LayerWeight", inputs={"Blend": 0.5}).outputs["Facing"]
    depth = n.math("SUBTRACT", 1.0, n.math("MULTIPLY", n.math("POWER", facing, 2.0), 0.35))
    emission = n.add("Emission", inputs={"Color": tint, "Strength": depth})
    coat = n.add("BsdfPrincipled", inputs={
        "Base Color": (0, 0, 0, 1), "Roughness": 0.05, "IOR": 1.5,
        "Coat Weight": 1.0, "Coat Roughness": 0.02, "Coat IOR": 1.5,
    })
    glass = n.add("AddShader", inputs=[emission.outputs[0], coat.outputs[0]])
    n.add("OutputMaterial", inputs={"Surface": glass.outputs[0]})
    obj.data.materials.append(mat)
    return obj


def main():
    a = args(samples=256, size=640)
    scene = reset()
    use_gpu(scene)
    scene.cycles.samples = a["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 16
    scene.cycles.transmission_bounces = 16
    scene.render.resolution_x = scene.render.resolution_y = a["size"]
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    # Plain sRGB keeps the brand colours where they are.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    background = nodes["Background"]
    background.inputs["Strength"].default_value = 0.9
    if HDRI:
        environment = nodes.new("ShaderNodeTexEnvironment")
        environment.image = bpy.data.images.load(str(HDRI[0]))
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value = (0, 0, math.radians(140))
        links.new(nodes.new("ShaderNodeTexCoord").outputs["Generated"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], environment.inputs["Vector"])
        links.new(environment.outputs["Color"], background.inputs["Color"])
    scene.world = world

    camera_data = bpy.data.cameras.new("Overhead")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = SIZE + 0.9
    camera = bpy.data.objects.new("Overhead", camera_data)
    camera.location = (0, 0, 40)
    scene.collection.objects.link(camera)
    scene.camera = camera

    # The header's lamp: upper left, long and soft, as over the glass rim.
    lamp_data = bpy.data.lights.new("Table lamp", "AREA")
    lamp_data.shape = "RECTANGLE"
    lamp_data.size, lamp_data.size_y = 30, 5
    lamp_data.energy = 3400
    lamp_data.color = srgb("#FFF4E6")
    lamp = bpy.data.objects.new("Table lamp", lamp_data)
    lamp.location = (-14, 16, 18)
    lamp.rotation_euler = (Vector((0, 0, 0)) - lamp.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(lamp)

    for index, (quadrant, colour) in enumerate(TILES):
        tile(f"Tile {index + 1}", quadrant, colour)

    RENDER.parent.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(RENDER)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(RENDER), check_existing=False)
    image.scale(160, 160)
    image.filepath_raw = str(OUT)
    image.file_format = "WEBP"
    image.save(quality=94)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "art" / "glass_mark.blend"))
    print(f"Saved {OUT}")


if __name__ == "__main__":
    main()
