"""Render the overhead photographer's loupe used over contact sheets.

Run (Blender 5.2, Cycles on the GPU):
  blender -b -P art/preview_loupe.py
  blender -b -P art/preview_loupe.py -- samples=512

Modelled on a stand loupe: a clear acrylic light-collecting skirt, a black
anodised aluminium barrel turned on a lathe, and a brushed aluminium bezel
around the lens. The centre of the aperture stays transparent; CSS fills it
with a live magnified crop of the photograph. Geometry and framing are fixed
so the aperture lines up with the CSS lens (88 px inside a 188 px sprite).
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import use_gpu  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src' / 'assets' / 'loupe' / 'preview-loupe.webp'
BLEND = ROOT / 'art' / 'preview_loupe.blend'


def option(name, default):
    for arg in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []:
        key, _, value = arg.partition('=')
        if key == name:
            return type(default)(value)
    return default


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
use_gpu(scene)
scene.cycles.samples = option('samples', 256)
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 16
scene.cycles.transmission_bounces = 16
# About twice the 188 px CSS sprite, for sharp edges on high-density screens.
scene.render.resolution_x = scene.render.resolution_y = 400
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
# Clear acrylic reads as clear: the cork and photograph show through it.
scene.cycles.film_transparent_glass = True
scene.cycles.film_transparent_roughness = 0.35
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.quality = 90
scene.render.filepath = str(OUT)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

# A neutral, slightly warm studio; the lamp over the light table.
world = bpy.data.worlds.new('Neutral studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.46, .44, .41, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .28
scene.world = world

camera_data = bpy.data.cameras.new('Overhead orthographic')
camera = bpy.data.objects.new('Overhead orthographic', camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 7.5)
target = Vector((0, 0, 1.06))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 3.35
scene.camera = camera


def principled(name, color, metallic=0.0, roughness=.3, transmission=0.0, ior=1.45, coat=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = ior
    p.inputs['Coat Weight'].default_value = coat
    return m, p


def turned(material, bsdf, rings=900.0, strength=.18, roughness=None):
    """Concentric lathe marks: a fine radial wave drives the bump and roughness."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    xyz = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coords.outputs['Object'], xyz.inputs['Vector'])
    radius = nodes.new('ShaderNodeVectorMath')
    radius.operation = 'LENGTH'
    combine = nodes.new('ShaderNodeCombineXYZ')
    links.new(xyz.outputs['X'], combine.inputs['X'])
    links.new(xyz.outputs['Y'], combine.inputs['Y'])
    links.new(combine.outputs['Vector'], radius.inputs[0])
    wave = nodes.new('ShaderNodeMath')
    wave.operation = 'SINE'
    scale = nodes.new('ShaderNodeMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = rings
    links.new(radius.outputs['Value'], scale.inputs[0])
    links.new(scale.outputs['Value'], wave.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 60
    noise.inputs['Detail'].default_value = 3
    mix = nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[2].default_value = 0
    links.new(wave.outputs['Value'], mix.inputs[0])
    links.new(noise.outputs['Fac'], mix.inputs[1])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = .002
    links.new(mix.outputs['Value'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    if roughness is not None:
        ramp = nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0
        ramp.inputs['From Max'].default_value = 1
        ramp.inputs['To Min'].default_value = roughness[0]
        ramp.inputs['To Max'].default_value = roughness[1]
        links.new(noise.outputs['Fac'], ramp.inputs['Value'])
        links.new(ramp.outputs['Result'], bsdf.inputs['Roughness'])


anodised, anodised_bsdf = principled('Black anodised aluminium', (.018, .018, .019), .9, .34)
turned(anodised, anodised_bsdf, rings=1100, strength=.22, roughness=(.28, .4))
wall, _ = principled('Anodised barrel wall', (.02, .02, .021), .88, .38)
bezel, bezel_bsdf = principled('Brushed aluminium bezel', (.78, .77, .75), 1.0, .2)
turned(bezel, bezel_bsdf, rings=1600, strength=.12, roughness=(.16, .26))
groove, _ = principled('Machined groove', (.03, .03, .031), .8, .3)
acrylic, _ = principled('Clear acrylic skirt', (.96, .96, .95), 0, .1, 1.0, 1.49)
lip, _ = principled('Polished acrylic lip', (.94, .94, .93), 0, .18, .8, 1.49, coat=.5)
inner, _ = principled('Acrylic inner wall', (.95, .95, .94), 0, .1, 1.0, 1.49)


def lathe(name, profile, material, count=256):
    verts = [(r * math.cos(i * math.tau / count), r * math.sin(i * math.tau / count), z)
             for r, z in profile for i in range(count)]
    faces = []
    for j in range(len(profile) - 1):
        for i in range(count):
            n = (i + 1) % count
            faces.append((j * count + i, j * count + n,
                          (j + 1) * count + n, (j + 1) * count + i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


# Light-collecting skirt: clear acrylic with a rolled, polished bottom lip.
lathe('Acrylic skirt', [(1.40, .12), (1.46, .15), (1.47, .20),
      (1.38, .59), (1.21, 1.17), (1.10, 1.42)], acrylic)
lathe('Rolled acrylic lip', [(1.44, .13), (1.48, .16), (1.48, .19),
      (1.46, .22), (1.43, .20)], lip)
lathe('Skirt inner wall', [(1.35, .17), (1.30, .34), (1.15, 1.12)], inner)

# The barrel. Its top face is the ring seen from above; the centre stays open.
lathe('Anodised barrel', [(1.09, 1.20), (1.16, 1.28), (1.17, 1.69),
      (1.14, 1.83), (1.04, 1.96), (.93, 2.015), (.79, 2.02),
      (.77, 1.99), (.77, 1.92), (.80, 1.84)], anodised)
lathe('Barrel wall', [(1.09, 1.24), (1.16, 1.31), (1.17, 1.58),
      (1.16, 1.73)], wall)
lathe('Lens bezel', [(.77, 1.91), (.77, 1.99), (.79, 2.02),
      (.82, 2.025), (.84, 2.01)], bezel)
lathe('Turned shoulder groove', [(1.02, 1.969), (1.045, 1.968),
      (1.055, 1.95)], groove)
lathe('Chamfered shoulder', [(1.12, 1.855), (1.135, 1.84),
      (1.14, 1.82)], bezel)
lathe('Barrel seam', [(1.09, 1.22), (1.14, 1.24), (1.15, 1.28)], groove)


def light(name, location, power, size, color, shape='DISK'):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = shape
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()


# One broad overhead lamp, one small key that draws a crisp sweep across the
# turned metal, and a dim warm bounce from the cork below.
light('Overhead lamp', (-2.8, 3.2, 8), 1100, 6, (1, .98, .95))
light('Key sweep', (3.4, 2.6, 4.2), 520, 1.1, (1, 1, 1))
light('Cork bounce', (1.5, -3.5, .8), 160, 4, (1, .8, .6), 'RECTANGLE')

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.render.render(write_still=True)
print(f'Loupe rendered to {OUT}')
