# Shared scene setup for the Blender render scripts in this folder.
import math
import sys

import bpy
from mathutils import Vector


def args(**defaults):
    """Parse `-- key=value ...` from the Blender command line over defaults."""
    out = dict(defaults)
    if "--" in sys.argv:
        for pair in sys.argv[sys.argv.index("--") + 1:]:
            k, v = pair.split("=", 1)
            out[k] = type(defaults[k])(v) if k in defaults else v
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def cycles(scene, size, samples, transparent=False):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.resolution_x, scene.render.resolution_y = size if isinstance(size, tuple) else (size, size)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.image_settings.color_depth = "8"
    # Plain sRGB out, so colours land where the CSS expects them.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def world(scene, rgb, strength):
    w = bpy.data.worlds.new("World")
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*rgb, 1)
    bg.inputs["Strength"].default_value = strength


def sun(scene, frm, strength, angle_deg, rgb=(1, 1, 1)):
    """A sun shining from direction `frm` (x right, y up the image, z toward camera)."""
    data = bpy.data.lights.new("Sun", "SUN")
    data.energy = strength
    data.angle = math.radians(angle_deg)
    data.color = rgb
    ob = bpy.data.objects.new("Sun", data)
    ob.rotation_euler = Vector(frm).to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(ob)
    return ob


def top_camera(scene, ortho_scale=None, lens=None, height=10.0):
    data = bpy.data.cameras.new("Camera")
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    data.clip_end = height * 4
    ob = bpy.data.objects.new("Camera", data)
    ob.location = (0, 0, height)
    scene.collection.objects.link(ob)
    scene.camera = ob
    return ob


class Nodes:
    """Terse node-graph builder: n.add('Math', operation='MULTIPLY', inputs=[a, 2])."""

    def __init__(self, tree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links

    def add(self, kind, inputs=None, **props):
        node = self.nodes.new(kind if kind.startswith(("Shader", "Node")) else "ShaderNode" + kind)
        for k, v in props.items():
            setattr(node, k, v)
        for i, v in (inputs.items() if isinstance(inputs, dict) else enumerate(inputs or [])):
            self.feed(node.inputs[i], v)
        return node

    def feed(self, sock, v):
        if v is None:
            return
        if hasattr(v, "is_output") or hasattr(v, "outputs"):
            out = v if hasattr(v, "is_output") else v.outputs[0]
            self.links.new(out, sock)
        else:
            if isinstance(v, tuple) and len(v) == 3 and len(sock.default_value) == 4:
                v = (*v, 1.0)
            sock.default_value = v

    def math(self, op, a, b=None, clamp=False):
        n = self.add("Math", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return n.outputs[0]

    def vmath(self, op, a, b=None):
        n = self.add("VectorMath", operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return n.outputs["Vector"] if op not in ("LENGTH", "DOT_PRODUCT", "DISTANCE") else n.outputs["Value"]

    def mix(self, fac, a, b, blend="MIX", kind="RGBA"):
        n = self.add("Mix", data_type=kind, blend_type=blend)
        if kind == "RGBA":
            self.feed(n.inputs[0], fac); self.feed(n.inputs[6], a); self.feed(n.inputs[7], b)
            return n.outputs[2]
        self.feed(n.inputs[0], fac); self.feed(n.inputs[2], a); self.feed(n.inputs[3], b)
        return n.outputs[0]

    def ramp(self, fac, stops, interp="LINEAR"):
        n = self.add("ValToRGB")
        n.color_ramp.interpolation = interp
        els = n.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = (*col, 1) if len(col) == 3 else col
        self.feed(n.inputs[0], fac)
        return n.outputs[0]


def srgb(hex_or_rgb):
    """sRGB (hex string or 0-255 triple) -> linear floats for node colour sockets."""
    if isinstance(hex_or_rgb, str):
        h = hex_or_rgb.lstrip("#")
        hex_or_rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(c / 255) for c in hex_or_rgb)
