"""Render the photographic table's machined metal hand loupe.

Run from the project root:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b -P art/loupe.py

The 768px transparent sprite is designed for a 188px CSS head.  Its aperture
is 384px across (86px CSS radius at a 188/420 scale), centered at (270, 270).
No glass surface fills the hole: the web UI places the live magnified photo
under this sprite.  The handle extends down and to the right.
"""

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "assets" / "loupe"
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.quality = 100
scene.render.filepath = str(OUT / "loupe.webp")
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = True
scene.camera = None

# One Blender unit is 100 output pixels.  A top orthographic camera keeps the
# hole precisely round and makes CSS placement independent of perspective.
camera_data = bpy.data.cameras.new("Top orthographic camera")
camera = bpy.data.objects.new("Top orthographic camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 16)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 7.68
scene.camera = camera

world = bpy.data.worlds.new("Neutral studio environment")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.70, 0.72, 0.75, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.62
scene.world = world


def material(name, rgb, metallic=0.0, roughness=0.3, anisotropic=0.0, bump=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Anisotropic"].default_value = anisotropic
    if bump:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 250
        tex.inputs["Detail"].default_value = 2.0
        tex.inputs["Roughness"].default_value = 0.72
        bump_node = nodes.new("ShaderNodeBump")
        bump_node.inputs["Strength"].default_value = 0.12
        bump_node.inputs["Distance"].default_value = bump
        links.new(tex.outputs["Fac"], bump_node.inputs["Height"])
        links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


nickel = material("Satin machined nickel", (0.62, 0.65, 0.68), 1, 0.22, 0.42, 0.00065)
edge = material("Polished rolled edge", (0.78, 0.81, 0.83), 1, 0.115, 0.18)
inner = material("Darkened inner wall", (0.31, 0.34, 0.37), 1, 0.31, 0.45)
engraving = material("Recessed concentric dark steel", (0.25, 0.28, 0.30), 1, 0.27)
ferrule = material("Chrome ferrule", (0.71, 0.74, 0.76), 1, 0.16, 0.24)
baked = material("Black Bakelite grip", (0.009, 0.011, 0.013), 0.05, 0.34, 0, 0.002)
grip_end = material("Bakelite end cap", (0.012, 0.014, 0.016), 0.05, 0.31, 0, 0.002)

CX = -1.14     # image pixel 270
CY = 1.14      # image pixel 270


def turned_ring(name, profile, mat, steps=256):
    """Create a closed, smooth lathed ring from (radius, height) coordinates."""
    verts = []
    for radius, z in profile:
        verts.extend((CX + radius * math.cos(i * math.tau / steps),
                      CY + radius * math.sin(i * math.tau / steps), z)
                     for i in range(steps))
    faces = []
    n = len(profile)
    for j in range(n):
        k = (j + 1) % n
        for i in range(steps):
            ni = (i + 1) % steps
            faces.append((j * steps + i, j * steps + ni,
                          k * steps + ni, k * steps + i))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return ob


# Back plate, folded bezel, rolled inside edge, and etched circular hairline.
# The open radius never shrinks below 1.92 units = 86px in CSS.
turned_ring("One piece nickel bezel", [
    (1.92, 0.07), (1.921, 0.16), (1.927, 0.25),
    (1.948, 0.302), (1.98, 0.324), (2.046, 0.327),
    (2.081, 0.305), (2.100, 0.270), (2.105, 0.217),
    (2.101, 0.153), (2.075, 0.082), (2.04, 0.063)
], nickel)
turned_ring("Polished inner lip", [
    (1.923, 0.251), (1.928, 0.284), (1.945, 0.310),
    (1.963, 0.323), (1.975, 0.319), (1.960, 0.285)
], edge)
turned_ring("Outer rolled rim", [
    (2.060, 0.311), (2.080, 0.307), (2.097, 0.285),
    (2.105, 0.266), (2.098, 0.244), (2.087, 0.271)
], edge)
turned_ring("Fine black concentric groove", [
    (2.017, 0.328), (2.021, 0.331), (2.029, 0.331), (2.033, 0.328)
], engraving)
turned_ring("Inner edge shadow", [
    (1.922, 0.085), (1.922, 0.182), (1.928, 0.226), (1.933, 0.196)
], inner)

# A side ferrule and Bakelite hand grip at four-thirty.  Circular sections
# are actually modeled, with metal trim and soft beveled changes in radius.
direction = Vector((math.sqrt(0.5), -math.sqrt(0.5), 0))
axis_rotation = Vector((0, 0, 1)).rotation_difference(direction)
handle_origin = Vector((CX, CY, 0.207))


def handle_part(name, start, end, profile, mat, resolution=64):
    """Profile radius along a local cylinder from start to end, then rotate."""
    distance = end - start
    verts = []
    for t, radius in profile:
        for i in range(resolution):
            a = i * math.tau / resolution
            verts.append((radius * math.cos(a), radius * math.sin(a), t * distance))
    faces = []
    n = len(profile)
    for j in range(n - 1):
        for i in range(resolution):
            ni = (i + 1) % resolution
            faces.append((j * resolution + i, j * resolution + ni,
                          (j + 1) * resolution + ni, (j + 1) * resolution + i))
    faces.append(tuple(reversed(tuple(range(resolution)))))
    faces.append(tuple((n - 1) * resolution + i for i in range(resolution)))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    ob.location = handle_origin + direction * start
    ob.rotation_euler = axis_rotation.to_euler()
    ob.data.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    bevel = ob.modifiers.new("Soft manufactured edges", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 3
    ob.modifiers.new("Weighted end normals", "WEIGHTED_NORMAL")
    return ob


handle_part("Solid welded neck", 1.98, 2.74,
            [(0, .138), (.05, .149), (.56, .149), (.93, .138), (1, .138)],
            nickel)
handle_part("Neck coupling collar", 2.38, 2.53,
            [(0, .178), (.12, .184), (.84, .184), (1, .174)], ferrule)
handle_part("Polished head ferrule", 2.70, 2.89,
            [(0, .177), (.08, .193), (.18, .200), (.84, .200), (1, .180)],
            ferrule)
handle_part("Black molded grip", 2.83, 4.52,
            [(0, .185), (.045, .199), (.12, .211), (.23, .219),
             (.70, .219), (.87, .210), (.96, .191), (1, .174)], baked)
handle_part("Grip heel nickel ring", 4.43, 4.50,
            [(0, .176), (.12, .181), (.88, .180), (1, .172)], ferrule)
handle_part("Bakelite heel", 4.48, 4.59,
            [(0, .177), (.2, .18), (.77, .167), (1, .145)], grip_end)

# Finely cut concentric ridges on the near end of the handle.  They become
# subtle breaks in the long studio reflection at the final display size.
for i in range(4):
    at = 2.96 + i * .065
    handle_part(f"Grip turning {i + 1}", at, at + .010,
                [(0, .214), (.15, .217), (.85, .217), (1, .214)], grip_end, 48)


def softbox(name, location, energy, size_x, size_y, color):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.energy = energy
    data.size = size_x
    data.size_y = size_y
    data.color = color
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (Vector((CX, CY, 0)) - ob.location).to_track_quat("-Z", "Y").to_euler()


softbox("Wide silk overhead left", (-3.7, 4.7, 7.5), 740, 2.5, 5.5, (1.0, .97, .92))
softbox("Long cool white strip", (4.2, 2.0, 5.1), 430, .9, 4.5, (.82, .90, 1.0))
softbox("Bottom bounce", (1.1, -5.3, 4.0), 150, 4.0, 1.7, (1.0, .85, .72))
softbox("Dark field rim break", (-4.4, -4.3, 2.1), 85, 1.6, 1.6, (.92, .98, 1.0))

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "art" / "loupe.blend"))
bpy.ops.render.render(write_still=True)
print(f"Loupe WebP: {scene.render.filepath}")
