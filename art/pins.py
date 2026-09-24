# Plastic push pins, seen from above with their shadow, as transparent sprites.
#
#   blender -b -P art/pins.py -- outdir=renders size=256 samples=256
#
# Writes <outdir>/pin-<colour>-<variant>-{full,bare}.png: `full` includes the
# shadow caught on the board, `bare` is the pin alone. finish_sprites.py
# combines the two into one sprite with a warm, cork-coloured shadow.
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Euler
from common import Nodes, args, cycles, reset, srgb, sun, top_camera, world

a = args(outdir="renders", size=256, samples=256)
scene = reset()
cycles(scene, a["size"], a["samples"], transparent=True)
world(scene, srgb((236, 226, 214)), 0.55)
sun(scene, (-1.0, 1.0, 1.5), 3.0, 6.0, srgb((255, 243, 226)))
# Soft box up and to the left for a broad specular highlight on the cap.
box = bpy.data.lights.new("Box", "AREA")
box.energy, box.size = 450.0, 18.0
box_ob = bpy.data.objects.new("Box", box)
box_ob.location = (-22, 22, 34)
box_ob.rotation_euler = box_ob.location.to_track_quat("Z", "Y").to_euler()
scene.collection.objects.link(box_ob)
top_camera(scene, ortho_scale=30.0, height=60.0)  # units are millimetres

# Revolved profile, (radius, height) in mm, from the flange's underside up to the cap.
PROFILE = [(0.0, 0.0), (5.1, 0.0), (5.45, 0.25), (5.5, 0.75), (5.3, 1.15), (4.6, 1.4), (3.3, 1.75),
           (2.95, 2.3), (2.55, 3.6), (2.4, 5.0), (2.55, 6.1), (3.2, 7.0), (3.75, 7.6), (3.85, 8.2),
           (3.6, 8.75), (2.8, 9.2), (1.4, 9.45), (0.0, 9.5)]
mesh = bpy.data.meshes.new("PinProfile")
mesh.from_pydata([(r, 0, z) for r, z in PROFILE], [(i, i + 1) for i in range(len(PROFILE) - 1)], [])
pin = bpy.data.objects.new("Pin", mesh)
scene.collection.objects.link(pin)
screw = pin.modifiers.new("Screw", "SCREW")
screw.axis, screw.steps, screw.render_steps = "Z", 96, 96
screw.use_merge_vertices, screw.use_smooth_shade = True, True
sub = pin.modifiers.new("Subsurf", "SUBSURF")
sub.levels = sub.render_levels = 2

bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=8.0, location=(0, 0, -4.0))
steel = bpy.context.active_object
steel.parent = pin

bpy.ops.mesh.primitive_plane_add(size=80)
board = bpy.context.active_object
board.is_shadow_catcher = True

plastic = bpy.data.materials.new("Plastic")
nt = plastic.node_tree
nt.nodes.clear()
n = Nodes(nt)
bsdf = n.add("BsdfPrincipled", inputs={"Roughness": 0.22, "Specular IOR Level": 0.55, "Coat Weight": 0.35,
                                       "Coat Roughness": 0.08, "Subsurface Weight": 0.12,
                                       "Subsurface Scale": 0.6})
n.add("OutputMaterial", inputs={"Surface": bsdf})
pin.data.materials.append(plastic)

metal = bpy.data.materials.new("Steel")
mt = Nodes(metal.node_tree)
mt.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
mt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
steel.data.materials.append(metal)

COLOURS = {"ivory": "#EFE8DC", "graphite": "#34373D", "red": "#B3301F"}
# Each variant leans the pin a few degrees a different way, as if pushed in by hand.
LEANS = [(7.0, 135.0), (5.0, 60.0), (8.0, 210.0)]

for name, hex_ in COLOURS.items():
    bsdf.inputs["Base Color"].default_value = (*srgb(hex_), 1)
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.4) if name != "graphite" else (0.2, 0.2, 0.2)
    for vi, (lean, toward) in enumerate(LEANS):
        # Tilt about the needle's entry point, so the sprite's centre stays on it.
        t = math.radians(toward)
        axis = (-math.sin(t), math.cos(t))
        pin.rotation_euler = Euler((math.radians(lean) * axis[0], math.radians(lean) * axis[1], 0.0), "XYZ")
        for kind, catch in (("full", True), ("bare", False)):
            board.hide_render = not catch
            scene.render.filepath = os.path.abspath(os.path.join(a["outdir"], f"pin-{name}-{vi + 1}-{kind}.png"))
            bpy.ops.render.render(write_still=True)
