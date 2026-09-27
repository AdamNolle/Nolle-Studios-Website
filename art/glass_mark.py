"""Render the studio's four-square mark as one piece of optical glass.

Blender 5.2 (Cycles on the GPU):
  blender -b -P art/glass_mark.py
  blender -b -P art/glass_mark.py -- samples=512

A single thick optical-glass lens sits over smoke, blue, green and red
laminated quadrants. Hairline seams stay below the uninterrupted reflective
surface, so the mark reads as one crafted object instead of four plastic
buttons. Surface transmission, volume absorption and two studio softboxes
create the depth and reflections. The camera is just off axis so the lower
edge reveals physical thickness. The background renders transparent.

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
SIZE, GAP, THICK = 16.0, 0.38, 3.0
OUTER, INNER, SHOULDER = 2.85, 0.48, 1.0
TILES = [  # (x, y) quadrant, laminate colour
    ((-1, 1), "#070B10"),
    ((1, 1), "#3447FF"),
    ((-1, -1), "#62F523"),
    ((1, -1), "#FF2633"),
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


def glass_body():
    half = SIZE / 2
    ring = outline(-half, -half, half, half, [OUTER] * 4)
    count = len(ring)
    verts = [(x, y, z) for z in (0.0, THICK) for x, y in ring]
    faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))] + [
        (i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)
    ]
    mesh = bpy.data.meshes.new("Optical glass body")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Optical glass body", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bevel = obj.modifiers.new("Pillowed edge", "BEVEL")
    bevel.width = SHOULDER
    bevel.segments = 12
    bevel.profile = 0.62
    bevel.limit_method = "ANGLE"
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    mat = bpy.data.materials.new("Clear optical glass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    n = Nodes(nt)
    noise = n.add("TexNoise", inputs={"Scale": 34.0, "Detail": 2.0, "Roughness": 0.55})
    roughness = n.add("MapRange", inputs={"Value": noise.outputs["Fac"], "From Min": 0.0, "From Max": 1.0, "To Min": 0.035, "To Max": 0.075})
    surface = n.add("BsdfPrincipled", inputs={
        "Base Color": (*srgb("#EDF5FF"), 1), "Roughness": roughness.outputs["Result"], "IOR": 1.5,
        "Transmission Weight": 0.88, "Coat Weight": 0.5, "Coat Roughness": 0.018, "Coat IOR": 1.52,
    })
    volume = n.add("VolumeAbsorption", inputs={"Color": (*srgb("#DCEBFF"), 1), "Density": 0.008})
    n.add("OutputMaterial", inputs={"Surface": surface.outputs[0], "Volume": volume.outputs[0]})
    obj.data.materials.append(mat)
    return obj


def laminate(name, quadrant, colour):
    qx, qy = quadrant
    half = SIZE / 2
    x0, x1 = (-half, -GAP / 2) if qx < 0 else (GAP / 2, half)
    y0, y1 = (-half, -GAP / 2) if qy < 0 else (GAP / 2, half)
    # The mark's outer corner is round; the three that meet the others are nearly square.
    outer = {(-1, 1): 0, (1, 1): 1, (1, -1): 2, (-1, -1): 3}[quadrant]
    radii = [INNER] * 4
    radii[outer] = OUTER
    # Color sits below the uninterrupted glass face, like a piece of optical
    # signage glass. The seams are in the laminate, not raised button edges.
    inset = 0.18
    back_ring = outline(x0 + inset, y0 + inset, x1 - inset, y1 - inset,
                        [max(0.12, r - inset) for r in radii])
    back_mesh = bpy.data.meshes.new(f"{name} laminate")
    back_mesh.from_pydata([(x, y, 0.18) for x, y in back_ring], [], [tuple(range(len(back_ring)))])
    back_mesh.update()
    backing = bpy.data.objects.new(f"{name} laminate", back_mesh)
    bpy.context.scene.collection.objects.link(backing)
    back_mat = bpy.data.materials.new(f"{name} colour backing")
    back_mat.use_nodes = True
    back = back_mat.node_tree.nodes.get("Principled BSDF")
    back.inputs["Base Color"].default_value = (*srgb(colour), 1)
    back.inputs["Roughness"].default_value = 0.24
    back.inputs["Coat Weight"].default_value = 0.18
    back.inputs["Coat Roughness"].default_value = 0.08
    # Preserve the electric identity colours after the light passes through
    # three millimetres of glass. The color source stays below the reflective
    # lens, unlike the older render whose outer surface looked self-lit.
    back.inputs["Emission Color"].default_value = (*srgb(colour), 1)
    back.inputs["Emission Strength"].default_value = 1.2
    backing.data.materials.append(back_mat)
    return backing


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
    background.inputs["Strength"].default_value = 0.42
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
    camera_data.ortho_scale = SIZE + 1.6
    camera = bpy.data.objects.new("Overhead", camera_data)
    camera.location = (0, -6.2, 40)
    camera.rotation_euler = (Vector((0, 0, 1.1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(camera)
    scene.camera = camera

    # The header's lamp: upper left, long and soft, as over the glass rim.
    lamp_data = bpy.data.lights.new("Table lamp", "AREA")
    lamp_data.shape = "RECTANGLE"
    lamp_data.size, lamp_data.size_y = 30, 5
    lamp_data.energy = 1700
    lamp_data.color = srgb("#FFF4E6")
    lamp = bpy.data.objects.new("Table lamp", lamp_data)
    lamp.location = (-7, 13, 20)
    lamp.rotation_euler = (Vector((0, 0, 0)) - lamp.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(lamp)

    # A narrow cool reflection makes the front face read as glass without a
    # hand-painted streak; it is a real softbox reflection and rolls naturally
    # across the bevel at the icon's displayed 34–38 px size.
    strip_data = bpy.data.lights.new("Cool strip", "AREA")
    strip_data.shape = "RECTANGLE"
    strip_data.size, strip_data.size_y = 21.0, 3.5
    strip_data.energy = 620
    strip_data.color = srgb("#DCEBFF")
    strip = bpy.data.objects.new("Cool strip", strip_data)
    strip.location = (2, 16, 18)
    strip.rotation_euler = (Vector((0, 0, 1.2)) - strip.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(strip)

    glass_body()
    for index, (quadrant, colour) in enumerate(TILES):
        laminate(f"Quadrant {index + 1}", quadrant, colour)

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
