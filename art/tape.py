"""Render the clear tape that holds prints to the board.

Blender 5.2 (Cycles on the GPU):
  blender -b -P art/tape.py -- outdir=art/renders/tape samples=128
  python3 art/finish_tape.py art/renders/tape src/assets/tape

Thin, torn, translucent film in two shapes: short pieces laid diagonally
across a photograph corner, and longer strips that straddle an edge. CSS
rotates and places them. Everything renders over transparency so the
photograph or cork shows through the film; finish_tape.py adds a soft
contact shadow and exports WebP.
"""

import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Nodes, args, reset, srgb, top_camera, use_gpu, world  # noqa: E402


TAPE_WIDTH = 19.0  # 3/4-inch tape, in millimetres.
# (shape, length in millimetres, angle, seed): two cut lengths per shape.
SHAPES = [("corner", 41.0, -1.4, 97), ("corner", 38.0, 2.4, 131), ("strip", 70.0, -2.2, 13), ("strip", 64.0, 1.6, 29)]


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
    use_gpu(scene)


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
    """Clear adhesive film: uneven glue, with torn and trapped-air edges that scatter more."""
    material = bpy.data.materials.new("Translucent adhesive film")
    material.use_nodes = True
    material.node_tree.nodes.clear()
    n = Nodes(material.node_tree)
    coordinates = n.add("TexCoord").outputs["Object"]
    xyz = n.add("SeparateXYZ", inputs={"Vector": coordinates})
    x, y = xyz.outputs[0], xyz.outputs[1]
    half_length = n.add("Value")
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
    # Real clear tape is nearly invisible: a faint haze in the body, crisper
    # long edges, and serrated cut ends that scatter light. What gives it
    # away is gloss, so the lamp's reflection does most of the work.
    opacity = n.math("ADD", 0.11, n.math("MULTIPLY", grain, 0.08))
    opacity = n.math("ADD", opacity, n.math("MULTIPLY", outer_edge, 0.34))
    opacity = n.math("ADD", opacity, n.math("MULTIPLY", cut_edge, 0.22))
    roughness = n.math("ADD", 0.08, n.math("MULTIPLY", grain, 0.1))
    bump = n.add("Bump", inputs={"Strength": 0.06, "Distance": 0.018, "Height": micro})
    body = n.add("BsdfPrincipled", inputs={
        "Base Color": (*srgb((246, 241, 227)), 1),
        "Roughness": roughness,
        "IOR": 1.47,
        "Normal": bump.outputs["Normal"],
        "Coat Weight": 0.6,
        "Coat Roughness": 0.06,
    })
    transparent = n.add("BsdfTransparent")
    mix = n.add("MixShader", inputs=[opacity, transparent.outputs[0], body.outputs[0]])
    n.add("OutputMaterial", inputs={"Surface": mix.outputs[0]})
    return material, half_length


def film_mesh(scene, material, length, angle, seed, corner):
    randomizer = random.Random(seed)
    nx, ny = 140, 42
    creases = []
    for _ in range(2 if corner else 3):
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
                # A strip straddles the print's edge, which lifts the film a
                # fraction of a millimetre: a ridge the raking light picks out.
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
    camera = top_camera(scene, ortho_scale=58, height=75)
    area_light(scene, "Large overhead diffusion", (-15, 14, 30), 750, 25, 18, (255, 251, 243))
    area_light(scene, "Narrow raking reflection", (4, -18, 19), 300, 3.8, 21, (248, 251, 255))
    scene.render.resolution_percentage = 100

    material, half_length = film_material()
    for index, (shape, length, angle, seed) in enumerate(SHAPES):
        corner = shape == "corner"
        if corner:
            scene.render.resolution_x, scene.render.resolution_y = 672, 336
            camera.data.ortho_scale = 58
        else:
            scene.render.resolution_x, scene.render.resolution_y = 960, 343
            camera.data.ortho_scale = 84
        half_length.outputs[0].default_value = length / 2
        obj = film_mesh(scene, material, length, angle, seed + 5, corner)
        name = f"tape-{shape}-{index % 2 + 1}"
        scene.render.filepath = os.path.abspath(os.path.join(a["outdir"], name + ".png"))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(obj, do_unlink=True)


if __name__ == "__main__":
    main()
