"""Render a transparent, tactile shutter badge with Blender 5.1.

Run with blender -b --python art/aperture_badge.py -- --output badge.png
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def material(name: str, color: tuple[float, float, float, float], metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def cylinder(name, radius, depth, z, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=160, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("machined edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.affect = "EDGES"
        obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def torus(name, radius, tube, z, mat):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=160, minor_segments=20,
        location=(0, 0, z), major_radius=radius, minor_radius=tube
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def blade(index, base_angle, mat):
    angle = base_angle + math.radians(index * 60)
    polar = lambda r, offset: (r * math.cos(angle + math.radians(offset)),
                               r * math.sin(angle + math.radians(offset)), 0.19 + index * 0.001)
    vertices = [polar(0.31, -8), polar(1.48, -12), polar(1.48, 46), polar(0.31, 46)]
    mesh = bpy.data.meshes.new(f"blade {index + 1}")
    mesh.from_pydata(vertices, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new(f"iris blade {index + 1}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    solidify = obj.modifiers.new("pressed metal", "SOLIDIFY")
    solidify.thickness = 0.025
    bevel = obj.modifiers.new("softened blade edge", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return obj


def tick(angle, radius, size, mat, name):
    radians = math.radians(angle)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(radius * math.cos(radians),
                                                      radius * math.sin(radians), 0.225))
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.rotation_euler[2] = radians
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("soft edge", "BEVEL")
    bevel.width = 0.12
    bevel.segments = 2
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")


def text_object(label, y, size, mat):
    curve = bpy.data.curves.new(label, "FONT")
    curve.body = label
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = 0.002
    curve.bevel_depth = 0.001
    obj = bpy.data.objects.new(label, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (0, y, 0.248)
    obj.data.materials.append(mat)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    output = Path(args[args.index("--output") + 1]) if "--output" in args else Path("aperture-badge.png")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    gunmetal = material("brushed blackened steel", (0.095, 0.105, 0.113, 1), 0.88, 0.34)
    bevel_metal = material("edge reflection", (0.34, 0.38, 0.39, 1), 0.92, 0.22)
    face = material("dark enamel", (0.015, 0.023, 0.026, 1), 0.33, 0.41)
    blades = [material(f"iris alloy {i}", (0.105 + i * 0.009, 0.112 + i * 0.008,
                                           0.119 + i * 0.008, 1), 0.78, 0.36)
              for i in range(6)]
    marking = material("warm nickel engraving", (0.56, 0.57, 0.53, 1), 0.82, 0.27)
    red = material("dark red enamel", (0.39, 0.08, 0.055, 1), 0.26, 0.22)

    cylinder("solid machined rim", 1.85, 0.22, 0, gunmetal, 0.055)
    cylinder("recessed inner well", 1.57, 0.08, 0.115, face, 0.012)
    torus("polished outer lip", 1.75, 0.035, 0.125, bevel_metal)
    torus("inner engraved lip", 1.53, 0.016, 0.18, marking)
    for index in range(6):
        blade(index, -10, blades[index])
    cylinder("black aperture opening", 0.245, 0.015, 0.226, face, 0.008)
    torus("opening rim", 0.248, 0.012, 0.235, bevel_metal)

    for index in range(24):
        angle = index * 15 + 7.5
        is_major = index % 3 == 0
        tick(angle, 1.66, (0.085 if is_major else 0.045, 0.012, 0.008),
             marking, f"engraved exposure mark {index + 1}")
    # One ruby index mark recalls the small red witness mark on a vintage lens.
    angle = math.radians(42)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.048,
                                         location=(1.65 * math.cos(angle),
                                                   1.65 * math.sin(angle), 0.225))
    bpy.context.object.name = "red witness mark"
    bpy.context.object.data.materials.append(red)
    text_object("NOLLE", -1.645, 0.18, marking)

    world = bpy.data.worlds.new("soft studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.46, 0.49, 0.51, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

    def area(name, location, energy, color, shape="DISK", size=4.0):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = shape
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat("-Z", "Y").to_euler()

    area("large warm softbox", (-3.5, 4, 6), 650, (1, 0.85, 0.69), size=5)
    area("cool edge strip", (4, -2, 5), 560, (0.69, 0.82, 1), size=3)
    area("low fill", (0, -5, 2), 240, (1, 1, 1), size=4)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, -1.05, 8.2)
    camera.rotation_euler = (Vector((0, 0, 0.07)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 4.15
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = str(output.resolve())
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(__file__).with_suffix(".blend")))
    bpy.ops.render.render(write_still=True)
    print(f"Rendered aperture badge: {output}")


if __name__ == "__main__":
    main()
