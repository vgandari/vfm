/**
 * slides/themeColor.ts
 *
 * Validates the YAML header's `theme-color` (REQ-103). The value is written into a style attribute, so only
 * the forms below are passed on and nothing else can reach the stylesheet.
 *
 * Accepted: #rgb, #rrggbb, rgb(r, g, b) with 0-255, hsl(h, s%, l%), and a CSS color name.
 */

const NAMES = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen"
  ).split(" ")
);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const HSL = /^hsl\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*\)$/i;

/** The color as it may be written into CSS, or undefined when it is not one of the accepted forms. */
export function parseThemeColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (HEX.test(v)) return v.toLowerCase();
  const rgb = RGB.exec(v);
  if (rgb) return rgb.slice(1, 4).every((n) => Number(n) <= 255) ? `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})` : undefined;
  const hsl = HSL.exec(v);
  if (hsl) return Number(hsl[1]) <= 360 && Number(hsl[2]) <= 100 && Number(hsl[3]) <= 100 ? `hsl(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%)` : undefined;
  return NAMES.has(v.toLowerCase()) ? v.toLowerCase() : undefined;
}
