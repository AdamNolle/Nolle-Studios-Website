"""Render the three injection-moulded pushpins used on the cork board.

Blender 5.1:
  blender -b -P art/pins.py -- outdir=art/renders/pins size=384 samples=96

The camera is fixed above the needle entry point. The translucent WebP
composites and their soft cork-coloured shadows are made by finish_sprites.py.
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Nodes, args, reset, srgb, top_camera, world  # noqa: E402


def setup_cycles(scene, size, samples):
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 30
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        devices = [d for d in prefs.devices if d.type == "OPTIX"]
        if not devices:
            raise RuntimeError("No OptiX device")
        for device in prefs.devices:
            device.use = device.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"


def area_light(scene, name, position, energy, shape, size, size_y, tint):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = shape
    data.size = size
    data.size_y = size_y
    data.color = srgb(tint)
    light = bpy.data.objects.new(name, data)
    light.location = position
    light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(light)


def revolved_pin(scene):
    # Millimetres. Wider underside flange, slender stem, and a gently domed
    # cap; three small rim steps make its moulding legible.
    profile = [
        (0.00, 0.02), (4.72, 0.02), (5.20, 0.18),
        (5.48, 0.42), (5.50, 0.72), (5.37, 0.98),
        (4.83, 1.16), (3.45, 1.52), (2.75, 2.05),
        (2.37, 3.30), (2.35, 5.25), (2.55, 6.16),
        (3.08, 6.91), (3.59, 7.43), (3.78, 7.89),
        (3.79, 8.31), (3.57, 8.78), (3.03, 9.20),
        (2.12, 9.51), (1.08, 9.68), (0.00, 9.72),
    ]
    mesh = bpy.data.meshes.new("moulded polypropylene profile")
    mesh.from_pydata([(r, 0, z) for r, z in profile],
                     [(i, i + 1) for i in range(len(profile) - 1)], [])
    pin = bpy.data.objects.new("Push pin", mesh)
    scene.collection.objects.link(pin)
    screw = pin.modifiers.new("Turned injection moulding", "SCREW")
    screw.axis = "Z"
    screw.steps = screw.render_steps = 128
    screw.use_merge_vertices = True
    screw.use_smooth_shade = True
    sub = pin.modifiers.new("Smoothed mould", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    return pin


def plastic_material():
    mat = bpy.data.materials.new("Satin plastic with clear coat")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    n = Nodes(mat.node_tree)
    noise = n.add("TexNoise", inputs={"Scale": 85.0, "Detail": 2.0, "Roughness": 0.7})
    bump = n.add("Bump", inputs={"Strength": 0.12, "Distance": 0.015, "Height": noise.outputs["Fac"]})
    rough = n.math("ADD", 0.15, n.math("MULTIPLY", noise.outputs["Fac"], 0.06))
    bsdf = n.add("BsdfPrincipled", inputs={
        "Roughness": rough,
        "Normal": bump.outputs["Normal"],
        "IOR": 1.48,
        "Coat Weight": 0.56,
        "Coat Roughness": 0.09,
        "Subsurface Weight": 0.035,
        "Subsurface Scale": 0.14,
    })
    n.add("OutputMaterial", inputs={"Surface": bsdf})
    return mat, bsdf


def neck_insert(scene, pin):
    # A pressed, brushed steel collar beneath the coloured cap is a tiny but
    # important cue at 55 CSS pixels, especially on white photographs.
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=2.43, depth=4.24,
                                        location=(0, 0, 4.34))
    insert = bpy.context.active_object
    insert.name = "Pressed steel neck insert"
    insert.parent = pin
    bevel = insert.modifiers.new("Machined edge", "BEVEL")
    bevel.width = 0.11
    bevel.segments = 3
    smooth = insert.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    smooth.keep_sharp = True
    for polygon in insert.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new("Smoked brushed steel")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb((81, 78, 73)), 1)
    bsdf.inputs["Metallic"].default_value = .64
    bsdf.inputs["Roughness"].default_value = .32
    insert.data.materials.append(material)
    return insert


def main():
    a = args(outdir="art/renders/pins", size=384, samples=96)
    os.makedirs(a["outdir"], exist_ok=True)
    scene = reset()
    setup_cycles(scene, a["size"], a["samples"])
    world(scene, srgb((242, 235, 225)), 0.37)
    camera = top_camera(scene, ortho_scale=30.0, height=55.0)
    # The board is viewed almost overhead, but a shallow three-quarter angle
    # exposes the pin's stem and underside. The lens still targets its needle
    # entry point, which is the sprite's CSS anchor.
    camera.location = (12, -30, 47)
    camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    area_light(scene, "Warm softbox upper left", (-17, 18, 27), 880, "RECTANGLE", 8, 13, (255, 244, 228))
    area_light(scene, "Cool bounce lower right", (18, -16, 27), 86, "RECTANGLE", 13, 16, (216, 228, 242))
    # Hairline reflection gives the cap a specific, photographed light source.
    area_light(scene, "Narrow studio reflection", (-11, 8, 22), 210, "RECTANGLE", 1.6, 8, (255, 255, 253))
    pin = revolved_pin(scene)
    plastic, shader = plastic_material()
    pin.data.materials.append(plastic)
    neck_insert(scene, pin)
    colors = {"ivory": "#E9DED0", "graphite": "#33363A", "red": "#B5382A"}
    leans = [(6.0, 135), (4.5, 65), (7.0, 205)]

    for color_name, hex_color in colors.items():
        shader.inputs["Base Color"].default_value = (*srgb(hex_color), 1)
        for variant, (lean, azimuth) in enumerate(leans, start=1):
            theta = math.radians(azimuth)
            pin.rotation_euler = Euler((
                -math.sin(theta) * math.radians(lean),
                math.cos(theta) * math.radians(lean), 0), "XYZ")
            scene.render.filepath = os.path.abspath(os.path.join(
                a["outdir"], f"pin-{color_name}-{variant}.png"))
            bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
