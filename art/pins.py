"""Render photoreal push pins pushed into the board, with their real shadows.

Blender 5.2 (Cycles on the GPU):
  blender -b -P art/pins.py
  blender -b -P art/pins.py -- samples=384 size=512   # finer

A moulded push pin (dished flare, fluted grip, thumb disc) in five colours,
each at two leans. The room is lit by Blender's bundled CC0 interior HDRI plus
a lamp over the table, so reflections come from a real room rather than a few
cards. A shadow catcher records each pin's shadow on the print, so the WebP
composites directly over a photograph or cork. The needle's entry point is
the sprite's centre and its CSS anchor (34 mm across).

Writes src/assets/pins/pin-<colour>-<lean>.webp (256 x 256).
"""

import glob
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import args, reset, srgb, use_gpu  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "pins")
RENDERS = os.path.join(ROOT, "art", "renders", "pins")
HDRI = glob.glob(os.path.join(os.path.dirname(bpy.app.binary_path), "..", "Resources", "*", "datafiles", "studiolights", "world", "interior.exr"))

# Moulded plastic, sRGB. Red, blue and green echo the studio's mark.
PLASTICS = {"red": "#C81E17", "blue": "#1F3FD0", "green": "#3DAE17", "yellow": "#EDB300", "white": "#EFEDE6"}
# (lean in degrees, lean direction in degrees): a pin is never perfectly upright.
LEANS = [(6.0, 140), (9.0, 35)]

# Lathe profile in millimetres, (radius, height), needle end at z = 0.
PUSH = [
    (0.00, 0.30), (0.62, 0.30), (3.60, 0.02), (4.55, 0.10), (4.95, 0.34), (5.02, 0.62),
    (4.90, 0.92), (4.45, 1.18), (3.55, 1.62), (2.70, 2.35), (2.20, 3.30), (2.02, 4.40),
    (1.95, 6.50), (1.90, 9.40), (1.94, 11.30), (2.15, 12.45), (2.85, 13.25), (3.65, 13.72),
    (4.02, 14.05), (4.12, 14.45), (4.10, 15.05), (3.96, 15.42), (3.55, 15.68), (2.60, 15.84),
    (1.20, 15.90), (0.00, 15.91),
]


def setup(scene, size, samples):
    use_gpu(scene)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 16
    scene.cycles.transmission_bounces = 16
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"


def world(scene):
    """The bundled hotel-room HDRI, warmed to match the lamp over the table."""
    w = bpy.data.worlds.new("Room")
    w.use_nodes = True
    nodes, links = w.node_tree.nodes, w.node_tree.links
    bg = nodes["Background"]
    bg.inputs["Strength"].default_value = 0.9
    if HDRI:
        env = nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(os.path.abspath(HDRI[0]))
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value = (0, 0, math.radians(200))
        coords = nodes.new("ShaderNodeTexCoord")
        links.new(coords.outputs["Generated"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], env.inputs["Vector"])
        links.new(env.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (*srgb("#E9E1D6"), 1)
    scene.world = w


def area(scene, name, location, energy, size, colour, shape="DISK"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = shape
    data.size = size
    data.color = srgb(colour)
    light = bpy.data.objects.new(name, data)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 4)) - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(light)


def camera(scene):
    data = bpy.data.cameras.new("Board camera")
    data.type = "ORTHO"
    data.ortho_scale = 34.0
    data.clip_end = 400
    cam = bpy.data.objects.new("Board camera", data)
    # Nearly overhead with a shallow three-quarter tilt, aimed at the needle entry.
    cam.location = (10, -26, 52)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def lathe(name, profile, steps=192):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(r, 0, z) for r, z in profile], [(i, i + 1) for i in range(len(profile) - 1)], [])
    obj = bpy.data.objects.new(name, mesh)
    screw = obj.modifiers.new("Turned", "SCREW")
    screw.axis = "Z"
    screw.steps = screw.render_steps = steps
    screw.use_merge_vertices = True
    screw.use_smooth_shade = True
    sub = obj.modifiers.new("Moulded", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    return obj


def node(nodes, kind, operation=None, second=None, **inputs):
    """Add a shader node, set its operation, its second input and named inputs."""
    n = nodes.new(kind)
    if operation:
        n.operation = operation
    if second is not None:
        n.inputs[1].default_value = second
    for key, value in inputs.items():
        n.inputs[key].default_value = value
    return n


def plastic(colour, fluted):
    """Glossy moulded plastic with a little subsurface glow and mould texture."""
    mat = bpy.data.materials.new("Moulded plastic")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(colour), 1)
    bsdf.inputs["IOR"].default_value = 1.49
    bsdf.inputs["Subsurface Weight"].default_value = 0.3 if colour == PLASTICS["white"] else 0.15
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.5, 0.3)
    bsdf.inputs["Subsurface Scale"].default_value = 0.8
    bsdf.inputs["Coat Weight"].default_value = 0.35
    bsdf.inputs["Coat Roughness"].default_value = 0.05
    coords = nodes.new("ShaderNodeTexCoord")
    # Handling leaves the gloss uneven: fingerprints and faint scuffs.
    smudge = node(nodes, "ShaderNodeTexNoise", Scale=1.6, Detail=6.0, Roughness=0.7)
    links.new(coords.outputs["Object"], smudge.inputs["Vector"])
    rough = node(nodes, "ShaderNodeMapRange", **{"From Min": 0.35, "From Max": 0.75, "To Min": 0.1, "To Max": 0.26})
    links.new(smudge.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    # Orange peel from the mould, plus eight flutes on a push pin's grip.
    peel = node(nodes, "ShaderNodeTexNoise", Scale=160.0, Detail=2.0)
    links.new(coords.outputs["Object"], peel.inputs["Vector"])
    height = node(nodes, "ShaderNodeMath", "MULTIPLY", 0.06)
    links.new(peel.outputs["Fac"], height.inputs[0])
    if fluted:
        xyz = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coords.outputs["Object"], xyz.inputs["Vector"])
        angle = node(nodes, "ShaderNodeMath", operation="ARCTAN2")
        links.new(xyz.outputs["Y"], angle.inputs[0])
        links.new(xyz.outputs["X"], angle.inputs[1])
        times = node(nodes, "ShaderNodeMath", "MULTIPLY", 8.0)
        links.new(angle.outputs["Value"], times.inputs[0])
        flute = node(nodes, "ShaderNodeMath", operation="COSINE")
        links.new(times.outputs["Value"], flute.inputs[0])
        lower = node(nodes, "ShaderNodeMapRange", **{"From Min": 3.0, "From Max": 4.4})
        upper = node(nodes, "ShaderNodeMapRange", **{"From Min": 12.4, "From Max": 11.2})
        lower.interpolation_type = upper.interpolation_type = "SMOOTHSTEP"
        links.new(xyz.outputs["Z"], lower.inputs["Value"])
        links.new(xyz.outputs["Z"], upper.inputs["Value"])
        mask = node(nodes, "ShaderNodeMath", operation="MULTIPLY")
        links.new(lower.outputs["Result"], mask.inputs[0])
        links.new(upper.outputs["Result"], mask.inputs[1])
        grooves = node(nodes, "ShaderNodeMath", operation="MULTIPLY")
        links.new(flute.outputs["Value"], grooves.inputs[0])
        links.new(mask.outputs["Value"], grooves.inputs[1])
        both = node(nodes, "ShaderNodeMath", operation="ADD")
        links.new(grooves.outputs["Value"], both.inputs[0])
        links.new(height.outputs["Value"], both.inputs[1])
        height = both
    bump = node(nodes, "ShaderNodeBump", Strength=0.3, Distance=0.05)
    links.new(height.outputs["Value"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def steel_needle(length, radius, z):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=length, location=(0, 0, z))
    obj = bpy.context.active_object
    obj.name = "Steel needle"
    mat = bpy.data.materials.new("Polished steel")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb("#CBCDCF"), 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.14
    obj.data.materials.append(mat)
    return obj


def build(scene):
    """The pin's parts under one parent, with the needle entry at the origin."""
    root = bpy.data.objects.new("Push pin", None)
    scene.collection.objects.link(root)
    head = lathe("Push pin head", PUSH)
    scene.collection.objects.link(head)
    head.parent = root
    steel_needle(3.0, 0.42, -1.2).parent = root
    return root, head


def board():
    """A shadow catcher standing in for the print the pin goes through."""
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "Print surface (shadow catcher)"
    plane.is_shadow_catcher = True


def main():
    a = args(size=512, samples=192)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "pin-*.webp")):
        os.remove(old)
    scene = reset()
    bpy.context.preferences.filepaths.save_version = 0
    setup(scene, a["size"], a["samples"])
    world(scene)
    camera(scene)
    # The lamp over the table: a broad key from the upper left throws the
    # shadow down and to the right, matching the prints' own shadows.
    area(scene, "Table lamp", (-24, 28, 72), 4200, 14, "#FFF3E2")
    board()

    root, head = build(scene)
    for colour, value in PLASTICS.items():
        head.data.materials.clear()
        head.data.materials.append(plastic(value, fluted=True))
        for lean_index, (lean, azimuth) in enumerate(LEANS, start=1):
            theta = math.radians(azimuth)
            root.rotation_euler = Euler((-math.sin(theta) * math.radians(lean), math.cos(theta) * math.radians(lean), 0), "XYZ")
            name = f"pin-{colour}-{lean_index}"
            png = os.path.join(RENDERS, name + ".png")
            scene.render.filepath = png
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(png, check_existing=False)
            image.scale(256, 256)
            image.filepath_raw = os.path.join(OUT, name + ".webp")
            image.file_format = "WEBP"
            image.save(quality=92)
            bpy.data.images.remove(image)
            print(name)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "pins.blend"))


if __name__ == "__main__":
    main()
