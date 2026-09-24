# Seamless cork-board tile, rendered straight down.
#
#   blender -b -P art/cork.py -- out=cork.png size=1536 samples=128
#
# Every texture is sampled on a flat torus (x and y each wrapped onto a circle
# and fed to 4D noise/Voronoi), so the height field and colour repeat exactly
# once per tile. The mesh extends past the camera's frame, so shadows falling
# across the tile edge come from the (identical) neighbouring tile: no seams.
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from common import Nodes, args, cycles, reset, srgb, sun, top_camera, world

a = args(out="cork.png", size=1536, samples=128, granule=165.0, relief=0.0022, grid=1600)
scene = reset()
cycles(scene, a["size"], a["samples"])
world(scene, srgb((255, 238, 218)), 0.5)
sun(scene, (-1.0, 1.0, 0.85), 3.05, 1.2, srgb((255, 243, 226)))
top_camera(scene, ortho_scale=1.0)

bpy.ops.mesh.primitive_grid_add(x_subdivisions=a["grid"], y_subdivisions=a["grid"], size=1.25)
plane = bpy.context.active_object

mat = bpy.data.materials.new("Cork")
mat.displacement_method = "BOTH"
nt = mat.node_tree
nt.nodes.clear()
n = Nodes(nt)

# --- periodic coordinates ------------------------------------------------
TAU = math.tau
R = 1 / TAU  # makes one tile == one unit of arc length on each circle
sep = n.add("SeparateXYZ", inputs=[n.add("TexCoord").outputs["Object"]])
u = n.math("MULTIPLY", sep.outputs[0], TAU)
v = n.math("MULTIPLY", sep.outputs[1], TAU)
A = n.add("CombineXYZ", inputs=[n.math("MULTIPLY", n.math("COSINE", u), R),
                                n.math("MULTIPLY", n.math("SINE", u), R),
                                n.math("MULTIPLY", n.math("COSINE", v), R)]).outputs[0]
W = n.math("MULTIPLY", n.math("SINE", v), R)


def noise(vec, w, scale, detail=2.0, rough=0.5, woff=0.0):
    return n.add("TexNoise", noise_dimensions="4D",
                 inputs={"Vector": vec, "W": n.math("ADD", w, woff), "Scale": scale,
                         "Detail": detail, "Roughness": rough})


def smooth(x, lo, hi):
    return n.add("MapRange", interpolation_type="SMOOTHSTEP",
                 inputs={"Value": x, "From Min": lo, "From Max": hi}).outputs[0]


def offset(noise_node, amt):
    vm = n.add("VectorMath", operation="SCALE")
    n.feed(vm.inputs[0], n.vmath("SUBTRACT", noise_node.outputs["Color"], (0.5, 0.5, 0.5)))
    vm.inputs["Scale"].default_value = amt
    return vm.outputs["Vector"]


def grey(x):
    return n.add("CombineColor", inputs=[x, x, x]).outputs[0]


# Warp the lattice twice: broadly so granules are irregular chunks, finely so
# their edges are crumbly rather than polygonal.
g = a["granule"]
Aw = n.vmath("ADD", A, n.vmath("ADD", offset(noise(A, W, g * 0.25, 3), 1.2 / g),
                                offset(noise(A, W, g * 2.2, 2, woff=3.1), 0.55 / g)))
Ww = n.math("ADD", W, n.math("MULTIPLY", n.math("SUBTRACT", noise(A, W, g * 0.25, 3, woff=11.7).outputs["Fac"], 0.5), 1.2 / g))

TONES = [(0.00, srgb((172, 112, 64))), (0.22, srgb((198, 142, 92))), (0.55, srgb((216, 164, 114))),
         (0.88, srgb((230, 184, 134))), (1.00, srgb((240, 204, 156)))]


def granules(scale, woff, lift, dark=0.0):
    """One layer of cork chunks: (height, colour). Tops are pressed nearly flat;
    a `dark` fraction are sunken bark chips."""
    w = n.math("ADD", Ww, woff)
    f1 = n.add("TexVoronoi", voronoi_dimensions="4D", feature="F1",
               inputs={"Vector": Aw, "W": w, "Scale": scale, "Randomness": 1.0})
    edge = n.add("TexVoronoi", voronoi_dimensions="4D", feature="DISTANCE_TO_EDGE",
                 inputs={"Vector": Aw, "W": w, "Scale": scale, "Randomness": 1.0}).outputs["Distance"]
    rnd = n.add("SeparateColor", inputs=[f1.outputs["Color"]])
    chip = n.math("LESS_THAN", rnd.outputs["Blue"], dark)
    height = n.math("ADD", n.math("ADD", n.math("MULTIPLY", rnd.outputs["Red"], 0.22),
                                  n.math("MULTIPLY", smooth(edge, 0.0, 0.09), 0.78)),
                    n.math("SUBTRACT", lift, n.math("MULTIPLY", chip, 0.3)))
    tone = n.mix(chip, n.ramp(rnd.outputs["Green"], TONES),
                 n.ramp(rnd.outputs["Red"], [(0.0, srgb((88, 48, 20))), (1.0, srgb((134, 78, 38)))]))
    return height, tone


def stack(lower, upper):
    (h0, c0), (h1, c1) = lower, upper
    return n.math("MAXIMUM", h0, h1), n.mix(n.math("GREATER_THAN", h1, h0), c0, c1)


h, col = stack(granules(g, 0.0, 0.0, 0.09), granules(g * 1.5, 5.3, -0.1, 0.12))
h, col = stack((h, col), granules(g * 2.7, 9.1, -0.42))

# Granules are themselves porous: fine cellular texture pitted into the tops.
pores = n.add("TexVoronoi", voronoi_dimensions="4D", feature="F1",
              inputs={"Vector": Aw, "W": n.math("ADD", Ww, 41.0), "Scale": g * 6.0, "Randomness": 1.0}).outputs["Distance"]
grain = noise(A, W, g * 4.0, 4, 0.62, woff=23.0).outputs["Fac"]
h = n.math("ADD", h, n.math("ADD", n.math("MULTIPLY", smooth(pores, 0.0, 0.5), 0.14),
                            n.math("MULTIPLY", grain, 0.22)))

# Scattered deep pits.
pit_v = n.add("TexVoronoi", voronoi_dimensions="4D", feature="F1",
              inputs={"Vector": Aw, "W": n.math("ADD", Ww, 17.0), "Scale": g * 1.6, "Randomness": 1.0})
pit_on = n.math("LESS_THAN", n.add("SeparateColor", inputs=[pit_v.outputs["Color"]]).outputs["Red"], 0.16)
pit = n.math("MULTIPLY", n.math("SUBTRACT", 1.0, smooth(pit_v.outputs["Distance"], 0.06, 0.3)), pit_on)
h = n.math("SUBTRACT", h, n.math("MULTIPLY", pit, 0.7))

# Colour: low crevices and pits go dark brown; fine grain and a soft broad
# mottle break up the flat tones.
col = n.mix(1.0, col, n.ramp(smooth(h, 0.0, 0.5), [(0.0, srgb((68, 36, 15))), (0.38, srgb((206, 180, 160))), (0.72, (1, 1, 1))]), "MULTIPLY")
col = n.mix(1.0, col, grey(n.math("ADD", 0.86, n.math("MULTIPLY", grain, 0.28))), "MULTIPLY")
mottle = noise(A, W, 6.0, 4, 0.55, woff=31.0).outputs["Fac"]
col = n.mix(1.0, col, n.ramp(mottle, [(0.35, srgb((244, 240, 236))), (0.65, (1, 1, 1))]), "MULTIPLY")

bsdf = n.add("BsdfPrincipled", inputs={"Base Color": col, "Roughness": 0.88, "Specular IOR Level": 0.2,
                                       "Sheen Weight": 0.3, "Sheen Roughness": 0.6})
disp = n.add("Displacement", inputs={"Height": h, "Midlevel": 0.5, "Scale": a["relief"]})
n.add("OutputMaterial", inputs={"Surface": bsdf, "Displacement": disp})
plane.data.materials.append(mat)

scene.render.filepath = os.path.abspath(a["out"])
bpy.ops.render.render(write_still=True)
