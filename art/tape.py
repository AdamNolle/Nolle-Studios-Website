"""Render translucent torn cellulose tape for print edges and corners.

Blender 5.1:
  blender -b -P art/tape.py -- outdir=art/renders/tape samples=128

Four slightly skewed, longer strips straddle photograph top edges. Two short
strips are centred on photograph corners and rotated in CSS. All are rendered
over transparency so the actual photograph or cork remains visible through
the film. finish_sprites.py adds soft contact shadows and exports WebP.
"""

import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Nodes, args, reset, srgb, top_camera, world  # noqa: E402


TAPE_WIDTH = 19.0  # 3/4-inch real-world tape, in millimetres.
VARIANTS = [
    ("tape-1", 69.0, -4.2, 13, False),
    ("tape-2", 65.0, 3.1, 29, False),
    ("tape-3", 73.0, -2.0, 43, False),
    ("tape-4", 67.0, 5.0, 71, False),
    ("tape-corner-1", 41.0, -1.4, 97, True),
    ("tape-corner-2", 38.0, 2.4, 131, True),
]


def setup_cycles(scene, samples):
    scene.render.engine = "CYCLES"
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


def area_light(scene, name, position, energy, size, size_y, rgb):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "RECTANGLE"
    data.size, data.size_y = size, size_y
    data.color = srgb(rgb)
    obj = bpy.data.objects.new(name, data)
    obj.location = position
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(obj)


def film_material():
    material = bpy.data.materials.new("Translucent adhesive film")
    material.use_nodes = True
    material.node_tree.nodes.clear()
    n = Nodes(material.node_tree)
    coordinates = n.add("TexCoord").outputs["Object"]
    xyz = n.add("SeparateXYZ", inputs={"Vector": coordinates})
    x, y = xyz.outputs[0], xyz.outputs[1]
    half_length = n.add("Value")
    body_density = n.add("Value")
    grain = n.add("TexNoise", inputs={"Vector": coordinates, "Scale": 0.9, "Detail": 2.8, "Roughness": 0.64}).outputs["Fac"]
    micro = n.add("TexNoise", inputs={"Vector": coordinates, "Scale": 7.0, "Detail": 1.5}).outputs["Fac"]
    outer_edge = n.add("MapRange", inputs={
        "Value": n.math("ABSOLUTE", y), "From Min": 8.35,
        "From Max": TAPE_WIDTH / 2, "To Min": 0.0, "To Max": 1.0,
    }).outputs[0]
    cut_edge = n.add("MapRange", inputs={
        "Value": n.math("ABSOLUTE", x),
        "From Min": n.math("SUBTRACT", half_length.outputs[0], 1.0),
        "From Max": half_length.outputs[0],
        "To Min": 0.0, "To Max": 1.0,
    }).outputs[0]
    # Uneven adhesive body is subtle; torn edges and trapped-air edges have
    # more scatter, while most of the photograph stays visible through it.
    opacity = n.math("ADD", body_density.outputs[0], n.math("MULTIPLY", grain, 0.14))
    opacity = n.math("ADD", opacity, n.math("MULTIPLY", outer_edge, 0.21))
    opacity = n.math("ADD", opacity, n.math("MULTIPLY", cut_edge, 0.14))
    roughness = n.math("ADD", 0.24, n.math("MULTIPLY", grain, 0.12))
    bump = n.add("Bump", inputs={"Strength": 0.04, "Distance": 0.018, "Height": micro})
    body = n.add("BsdfPrincipled", inputs={
        "Base Color": (*srgb((246, 241, 227)), 1),
        "Roughness": roughness,
        "IOR": 1.47,
        "Normal": bump.outputs["Normal"],
        "Coat Weight": 0.35,
        "Coat Roughness": 0.19,
    })
    transparent = n.add("BsdfTransparent")
    mix = n.add("MixShader", inputs=[opacity, transparent.outputs[0], body.outputs[0]])
    n.add("OutputMaterial", inputs={"Surface": mix.outputs[0]})
    return material, half_length, body_density


def film_mesh(scene, material, length, angle, seed, corner):
    randomizer = random.Random(seed)
    nx, ny = 140, 42
    creases = []
    for _ in range(3 if not corner else 2):
        creases.append((randomizer.uniform(-length * 0.40, length * 0.40),
                        randomizer.uniform(-6, 6),
                        randomizer.uniform(-0.8, 0.8),
                        randomizer.uniform(0.07, 0.16)))
    bubbles = [(randomizer.uniform(-length * .43, length * .43),
                randomizer.uniform(-6.7, 6.7),
                randomizer.uniform(0.7, 1.8),
                randomizer.uniform(0.025, 0.075)) for _ in range(5)]

    vertices = []
    for j in range(ny + 1):
        t = j / ny
        y = (t - 0.5) * TAPE_WIDTH
        # Dispenser serrations are cut into the mesh silhouette, with a
        # different tooth phase at each end. They are intentionally irregular.
        tooth_a = 0.62 * (0.5 + 0.5 * math.cos(y * 2 * math.pi / 1.05 + seed * .14))
        tooth_b = 0.60 * (0.5 + 0.5 * math.cos(y * 2 * math.pi / 1.19 + seed * .27))
        waviness = 0.075 * math.sin(t * 33 + seed)
        left, right = -length / 2 + tooth_a, length / 2 - tooth_b
        for i in range(nx + 1):
            s = i / nx
            x = left + s * (right - left)
            yy = y + (waviness if j == 0 else -waviness if j == ny else 0)
            z = 0.055
            if not corner:
                # The photograph edge lifts the film only a fraction of a
                # millimetre. It is visible as a raking-light ridge.
                z += .20 * math.exp(-((yy + .4) / 1.0) ** 2)
            for cx, cy, slant, amp in creases:
                across = (x - cx) * math.cos(slant) + (yy - cy) * math.sin(slant)
                along = -(x - cx) * math.sin(slant) + (yy - cy) * math.cos(slant)
                z += amp * math.exp(-(across / .35) ** 2) * math.exp(-(along / 7.5) ** 2)
            for bx, by, radius, amp in bubbles:
                z += amp * math.exp(-((x - bx) ** 2 + (yy - by) ** 2) / radius ** 2)
            # Light rolls around occasional adhesive lifts near the cut ends.
            z += 0.10 * math.exp(-((abs(x) - length / 2 + 1.2) / .95) ** 2)
            vertices.append((x, yy, z))
    faces = [(j * (nx + 1) + i,
              j * (nx + 1) + i + 1,
              (j + 1) * (nx + 1) + i + 1,
              (j + 1) * (nx + 1) + i)
             for j in range(ny) for i in range(nx)]
    mesh = bpy.data.meshes.new("torn film mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.shade_smooth()
    obj = bpy.data.objects.new("Torn cellulose tape", mesh)
    obj.rotation_euler = (0, 0, math.radians(angle))
    obj.data.materials.append(material)
    scene.collection.objects.link(obj)
    return obj


def main():
    a = args(outdir="art/renders/tape", samples=128)
    os.makedirs(a["outdir"], exist_ok=True)
    scene = reset()
    setup_cycles(scene, a["samples"])
    world(scene, srgb((245, 239, 230)), .8)
    camera = top_camera(scene, ortho_scale=84, height=75)
    area_light(scene, "Large overhead diffusion", (-15, 14, 30), 750, 25, 18, (255, 251, 243))
    area_light(scene, "Narrow raking reflection", (4, -18, 19), 300, 3.8, 21, (248, 251, 255))
    material, half_length, body_density = film_material()

    for name, length, angle, seed, corner in VARIANTS:
        if corner:
            scene.render.resolution_x, scene.render.resolution_y = 672, 336
            camera.data.ortho_scale = 58
        else:
            scene.render.resolution_x, scene.render.resolution_y = 960, 343
            camera.data.ortho_scale = 84
        scene.render.resolution_percentage = 100
        half_length.outputs[0].default_value = length / 2
        body_density.outputs[0].default_value = .27 if corner else .15
        obj = film_mesh(scene, material, length, angle, seed, corner)
        scene.render.filepath = os.path.abspath(os.path.join(a["outdir"], name + ".png"))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(obj, do_unlink=True)


if __name__ == "__main__":
    main()
