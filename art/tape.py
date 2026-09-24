# Strips of frosted tape across a print's top edge, seen from above, as
# transparent sprites.
#
#   blender -b -P art/tape.py -- outdir=renders samples=256
#
# The print lies along y < 0 in world space and the board along y > 0, so the
# tape bridges the print's edge (a faint ridge along its middle). Each variant
# bakes in its own angle to that edge plus its own creases and bubbles.
# Writes <outdir>/tape-<n>-{full,bare}.png for finish_sprites.py.
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from common import Nodes, args, cycles, reset, srgb, sun, top_camera, world

a = args(outdir="renders", samples=256, pxmm=12.8)
MM_W, MM_H = 84.0, 30.0            # canvas, millimetres
TAPE_W, PRINT_T = 19.0, 0.32       # 3/4" tape; photo paper thickness
VARIANTS = [(70, -4.5, 3), (64, 3.5, 11), (74, -2.0, 23), (68, 5.5, 37)]  # length, angle°, seed

scene = reset()
cycles(scene, (round(MM_W * a["pxmm"]), round(MM_H * a["pxmm"])), a["samples"], transparent=True)
world(scene, srgb((236, 226, 214)), 0.6)
sun(scene, (-1.0, 1.0, 1.5), 2.6, 5.0, srgb((255, 243, 226)))
# Broad ceiling light, nearly overhead, so the film shows a satin sheen that
# creases and bubbles break up.
box = bpy.data.lights.new("Box", "AREA")
box.energy, box.size = 26000.0, 60.0
box_ob = bpy.data.objects.new("Box", box)
box_ob.location = (-18, 22, 75)
box_ob.rotation_euler = box_ob.location.to_track_quat("Z", "Y").to_euler()
scene.collection.objects.link(box_ob)
top_camera(scene, ortho_scale=MM_W, height=80.0)

# Board and print both catch shadows; the print's own edge casts none.
bpy.ops.mesh.primitive_plane_add(size=200)
board = bpy.context.active_object
board.is_shadow_catcher = True
bpy.ops.mesh.primitive_cube_add(size=1)
paper = bpy.context.active_object
paper.scale = (200, 100, PRINT_T)
paper.location = (0, -50, PRINT_T / 2)
paper.is_shadow_catcher = True
paper.visible_shadow = False

# --- tape material -------------------------------------------------------
mat = bpy.data.materials.new("Tape")
n = Nodes(mat.node_tree)
mat.node_tree.nodes.clear()
sep = n.add("SeparateXYZ", inputs=[n.add("TexCoord").outputs["Object"]])
x, y = sep.outputs[0], sep.outputs[1]
half_len = n.add("Value")  # set per variant
pitch, depth = 1.15, 0.55


def teeth(phase):
    """Dispenser-cut edge: triangle wave across the tape's width, 0..depth."""
    f = n.math("FRACT", n.math("ADD", n.math("DIVIDE", y, pitch), phase))
    tri = n.math("ABSOLUTE", n.math("SUBTRACT", n.math("MULTIPLY", f, 2.0), 1.0))
    jag = n.add("TexNoise", inputs={"Vector": sep.inputs[0].links[0].from_socket, "Scale": 1.6, "Detail": 1.0}).outputs["Fac"]
    return n.math("MULTIPLY", tri, n.math("MULTIPLY", depth, n.math("ADD", 0.6, jag)))


inside = n.math("MULTIPLY",
                n.math("LESS_THAN", x, n.math("SUBTRACT", half_len.outputs[0], teeth(0.0))),
                n.math("GREATER_THAN", x, n.math("ADD", n.math("MULTIPLY", half_len.outputs[0], -1.0), teeth(0.37))))

# Milky film: denser at the slit edges and wherever the film tilts (creases, bubbles).
edge_band = n.math("SUBTRACT", 1.0, n.add("MapRange", inputs={"Value": n.math("ABSOLUTE", y), "From Min": TAPE_W / 2 - 0.35,
                                                              "From Max": TAPE_W / 2}).outputs[0])
tilt = n.add("LayerWeight", inputs={"Blend": 0.35}).outputs["Facing"]
frost = n.add("TexNoise", inputs={"Scale": 0.9, "Detail": 6.0, "Roughness": 0.6}).outputs["Fac"]
opacity = n.math("ADD", n.math("ADD", 0.2, n.math("MULTIPLY", frost, 0.06)),
                 n.math("ADD", n.math("MULTIPLY", n.math("SUBTRACT", 1.0, edge_band), 0.3),
                        n.math("MULTIPLY", tilt, 0.9)), clamp=True)
bump = n.add("Bump", inputs={"Strength": 0.08, "Height": frost})
film = n.add("BsdfDiffuse", inputs={"Color": srgb((250, 249, 245)), "Roughness": 0.5, "Normal": bump})
body = n.add("MixShader", inputs={"Fac": n.math("MULTIPLY", opacity, inside)})
n.feed(body.inputs[1], n.add("BsdfTransparent"))
n.feed(body.inputs[2], film)
# The film's surface reflects at full strength however thin it is, so its
# sheen is added on top of the see-through body rather than mixed into it.
shine = n.add("BsdfGlossy", inputs={"Color": (0.05, 0.05, 0.05), "Roughness": 0.32, "Normal": bump})
cut = n.add("MixShader", inputs={"Fac": inside})
n.feed(cut.inputs[1], n.add("BsdfTransparent"))
n.feed(cut.inputs[2], shine)
surface = n.add("AddShader")
n.feed(surface.inputs[0], body)
n.feed(surface.inputs[1], cut)
n.add("OutputMaterial", inputs={"Surface": surface})


# --- geometry --------------------------------------------------------------
def tape_mesh(length, angle_deg, seed):
    rnd = random.Random(seed)
    nx, ny = int(length * 6), int(TAPE_W * 6)
    ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    creases = []
    for end in (-1, 1):  # handled ends crease more than the middle
        for _ in range(rnd.randint(1, 3)):
            cx = end * (length / 2 - rnd.uniform(2, 14))
            creases.append((cx, rnd.uniform(-TAPE_W / 3, TAPE_W / 3), math.radians(rnd.uniform(-70, 70)),
                            rnd.uniform(4, 11), rnd.uniform(0.05, 0.11) * rnd.choice((1, -1))))
    bubbles = [(rnd.uniform(-length / 2.4, length / 2.4), rnd.uniform(-TAPE_W / 2.6, TAPE_W / 2.6),
                rnd.uniform(0.7, 2.2), rnd.uniform(0.03, 0.07)) for _ in range(rnd.randint(2, 4))]

    def height(lx, ly):
        wy = lx * sa + ly * ca                     # world y: across the print's edge
        bridge = PRINT_T * (1 - min(1, max(0, wy / 1.5)) ** 2 * (3 - 2 * min(1, max(0, wy / 1.5))))
        z = bridge if wy > 0 else PRINT_T
        for cx, cy, ang, ln, amp in creases:
            dx, dy = lx - cx, ly - cy
            along = dx * math.cos(ang) + dy * math.sin(ang)
            across = -dx * math.sin(ang) + dy * math.cos(ang)
            z += amp * math.exp(-(across / 0.28) ** 2) * math.exp(-(along / ln) ** 2)
        for bx, by, r, amp in bubbles:
            z += amp * math.exp(-((lx - bx) ** 2 + (ly - by) ** 2) / r ** 2)
        return z + 0.03  # film thickness plus adhesive

    verts = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            lx, ly = (i / nx - 0.5) * length, (j / ny - 0.5) * TAPE_W
            verts.append((lx, ly, height(lx, ly)))
    faces = [(j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i)
             for j in range(ny) for i in range(nx)]
    me = bpy.data.meshes.new("Tape")
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    ob = bpy.data.objects.new("Tape", me)
    ob.rotation_euler = (0, 0, math.radians(angle_deg))
    ob.data.materials.append(mat)
    scene.collection.objects.link(ob)
    return ob


for vi, (length, angle, seed) in enumerate(VARIANTS, start=1):
    half_len.outputs[0].default_value = length / 2
    tape = tape_mesh(length, angle, seed)
    for kind, catch in (("full", True), ("bare", False)):
        board.hide_render = paper.hide_render = not catch
        scene.render.filepath = os.path.abspath(os.path.join(a["outdir"], f"tape-{vi}-{kind}.png"))
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(tape)
