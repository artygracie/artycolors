// ArtyColors - Figma Plugin for Color Relationship Management
// Main thread code with access to Figma API and document

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type ColorRole = string; // Dynamic roles like 'Base', 'Color1', 'Color2', etc.
type HexColor = `#${string}`;

interface OKLCH {
  L: number; // Lightness [0, 1]
  C: number; // Chroma [0, ~0.4]
  H: number; // Hue [0, 360)
}

interface RelativeRule {
  Lmode: 'lighten' | 'darken';
  k: number;           // Lightness adjustment factor [0,1]
  Cmul: number;        // Chroma multiplier
  Cabs: number | null; // Absolute chroma (when base ~= 0)
  hDelta: number;      // Hue angle delta in degrees
}

interface Template {
  id: string;
  name: string;
  colorNames: Record<string, string>;     // Dynamic color names by role
  originalColors: Record<string, HexColor>; // Dynamic original colors by role  
  roles: Record<string, RelativeRule>;    // Dynamic rules for non-base roles
}

// Message types for UI communication
enum MessageType {
  ANALYZE_SELECTION = 'analyze-selection',
  UPDATE_ROLE = 'update-role',
  CREATE_TEMPLATE = 'create-template',
  APPLY_TEMPLATE = 'apply-template',
  BATCH_GENERATE = 'batch-generate',
  UPDATE_VARIANTS = 'update-variants',
  GET_TEMPLATES = 'get-templates'
}

interface LayerColorInfo {
  nodeId: string;
  layerName: string;
  displayName?: string; // Custom name set by user
  color: HexColor;
  role: string; // Dynamic role like 'Base', 'Color1', 'Color2', etc.
}

interface VariantInfo {
  name: string;       // User-provided name like "Dark Mode", "Accent Red"
  anchorColor: string; // Which color role to change (Base, Color1, etc.)
  hexColor: HexColor; // New color value for that role
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Natural sort that handles numbers correctly
 * "Rectangle 2" comes before "Rectangle 11"
 */
function naturalSort(a: string, b: string): number {
  const regex = /(\d+)/g;
  
  // Split strings into parts (text and numbers)
  const aParts = a.split(regex);
  const bParts = b.split(regex);
  
  const maxLength = Math.max(aParts.length, bParts.length);
  
  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] || '';
    const bPart = bParts[i] || '';
    
    // Check if both parts are numbers
    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);
    
    if (!isNaN(aNum) && !isNaN(bNum)) {
      // Compare as numbers
      if (aNum !== bNum) {
        return aNum - bNum;
      }
    } else {
      // Compare as strings
      const comparison = aPart.localeCompare(bPart);
      if (comparison !== 0) {
        return comparison;
      }
    }
  }
  
  return 0;
}

// =============================================================================
// OKLCH COLOR CONVERSION UTILITIES
// =============================================================================

/**
 * Convert hex color to OKLCH color space
 * Uses accurate sRGB -> Linear RGB -> OKLab -> OKLCH conversion
 */
function hexToOKLCH(hex: string): OKLCH {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Parse RGB values
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;
  
  // sRGB to Linear RGB
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  
  // Linear RGB to OKLab
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  
  // OKLab to OKLCH
  const C = Math.sqrt(a * a + b_ * b_);
  let H = Math.atan2(b_, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  
  return { L: Math.max(0, Math.min(1, L)), C: Math.max(0, C), H };
}

/**
 * Convert OKLCH to hex color with gamut clamping
 */
function oklchToHex(oklch: OKLCH): HexColor {
  const { L, C, H } = oklch;
  
  // OKLCH to OKLab
  const hRad = H * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b_oklab = C * Math.sin(hRad);
  
  // OKLab to Linear RGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b_oklab;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b_oklab;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b_oklab;
  
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  
  let lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  
  // Gamut clamp in linear RGB
  lr = Math.max(0, Math.min(1, lr));
  lg = Math.max(0, Math.min(1, lg));
  lb = Math.max(0, Math.min(1, lb));
  
  // Linear RGB to sRGB
  const fromLinear = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const r = fromLinear(lr);
  const g = fromLinear(lg);
  const b_srgb = fromLinear(lb);
  
  // Convert to hex
  const toHex = (c: number) => Math.round(Math.max(0, Math.min(255, c * 255))).toString(16).padStart(2, '0');
  
  return `#${toHex(r)}${toHex(g)}${toHex(b_srgb)}` as HexColor;
}

/**
 * Additional gamut clamping for edge cases
 */
function gamutClamp(oklch: OKLCH): OKLCH {
  // Simple chroma clamping - can be enhanced with more sophisticated algorithms
  const maxChroma = oklch.L * (1 - oklch.L) * 0.4; // Rough estimate
  return {
    ...oklch,
    C: Math.min(oklch.C, maxChroma)
  };
}

// =============================================================================
// RELATIVE COLOR RULE FUNCTIONS
// =============================================================================

/**
 * Compute relative rule between base color and role color
 */
function computeRelativeRule(baseColor: HexColor, roleColor: HexColor): RelativeRule {
  const baseOKLCH = hexToOKLCH(baseColor);
  const roleOKLCH = hexToOKLCH(roleColor);
  
  // Lightness relationship
  const deltaL = roleOKLCH.L - baseOKLCH.L;
  const Lmode: 'lighten' | 'darken' = deltaL >= 0 ? 'lighten' : 'darken';
  const k = Math.abs(deltaL);
  
  // Chroma relationship
  const Cmul = baseOKLCH.C > 0.01 ? roleOKLCH.C / baseOKLCH.C : 1;
  const Cabs = baseOKLCH.C <= 0.01 ? roleOKLCH.C : null;
  
  // Hue relationship
  let hDelta = roleOKLCH.H - baseOKLCH.H;
  if (hDelta > 180) hDelta -= 360;
  if (hDelta < -180) hDelta += 360;
  
  return { Lmode, k, Cmul, Cabs, hDelta };
}

/**
 * Apply relative rule to a new base color
 */
function applyRule(rule: RelativeRule, newBaseColor: HexColor): HexColor {
  const baseOKLCH = hexToOKLCH(newBaseColor);
  
  // Apply lightness transformation
  let newL = baseOKLCH.L;
  if (rule.Lmode === 'lighten') {
    newL = Math.min(1, baseOKLCH.L + rule.k);
  } else {
    newL = Math.max(0, baseOKLCH.L - rule.k);
  }
  
  // Apply chroma transformation
  let newC = rule.Cabs !== null ? rule.Cabs : baseOKLCH.C * rule.Cmul;
  
  // Apply hue transformation
  let newH = (baseOKLCH.H + rule.hDelta) % 360;
  if (newH < 0) newH += 360;
  
  const newOKLCH = gamutClamp({ L: newL, C: newC, H: newH });
  return oklchToHex(newOKLCH);
}

// =============================================================================
// ROLE MANAGEMENT FUNCTIONS
// =============================================================================

/**
 * Mark a node with a color role
 */
function markRole(node: SceneNode, role: string): void {
  node.setPluginData('colorRole', role);
}

/**
 * Get the color role of a node
 */
function getRole(node: SceneNode): string | null {
  const role = node.getPluginData('colorRole');
  return role || null;
}

/**
 * Infer role from layer name patterns like [Base], [A], [B], [C]
 */
function inferRoleFromName(name: string): string | null {
  const patterns = [
    { regex: /\[Base\]/i, role: 'Base' },
    { regex: /\[Color1\]/i, role: 'Color1' },
    { regex: /\[Color2\]/i, role: 'Color2' },
    { regex: /\[Color3\]/i, role: 'Color3' },
    { regex: /\[Color4\]/i, role: 'Color4' },
    { regex: /\[Color5\]/i, role: 'Color5' },
    // Legacy support
    { regex: /\[A\]/i, role: 'Color1' },
    { regex: /\[B\]/i, role: 'Color2' },
    { regex: /\[C\]/i, role: 'Color3' }
  ];
  
  for (const pattern of patterns) {
    if (pattern.regex.test(name)) {
      return pattern.role;
    }
  }
  
  return null;
}

/**
 * Index all nodes by their color roles within a root node
 */
function indexRoles(root: SceneNode): Record<string, SceneNode[]> {
  const roleIndex: Record<string, SceneNode[]> = {};
  
  const traverse = (node: SceneNode) => {
    // Check explicit role assignment first
    let role = getRole(node);
    
    // Fallback to name-based detection
    if (!role) {
      role = inferRoleFromName(node.name);
      if (role) {
        markRole(node, role); // Save inferred role
      }
    }
    
    // Add to index if role found and node has fills
    if (role && 'fills' in node) {
      if (!roleIndex[role]) {
        roleIndex[role] = [];
      }
      roleIndex[role].push(node);
    }
    
    // Recursively traverse children
    if ('children' in node) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };
  
  traverse(root);
  return roleIndex;
}

// =============================================================================
// COLOR ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Analyze a node and extract all colors with smart role assignment
 */
function analyzeNodeColors(root: SceneNode): LayerColorInfo[] {
  const layerColors: LayerColorInfo[] = [];
  const colorFrequency = new Map<string, number>();
  const allColorNodes: { node: SceneNode, color: HexColor }[] = [];
  
  // First pass: collect all colors and count frequency
  const traverse = (node: SceneNode) => {
    if ('fills' in node && node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
      const fill = node.fills[0];
      if (fill && fill.type === 'SOLID') {
        const hexColor = rgbToHex(fill.color);
        allColorNodes.push({ node, color: hexColor });
        colorFrequency.set(hexColor, (colorFrequency.get(hexColor) || 0) + 1);
      }
    }
    
    if ('children' in node) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };
  
  traverse(root);
  
  if (allColorNodes.length === 0) {
    return [];
  }
  
  // Sort colors by layer name (alphabetical)
  const sortedColors = allColorNodes
    .reduce((acc, { node, color }) => {
      if (!acc.find(item => item.color === color)) {
        const oklch = hexToOKLCH(color);
        acc.push({ 
          node, 
          color, 
          frequency: colorFrequency.get(color) || 1,
          lightness: oklch.L 
        });
      }
      return acc;
    }, [] as { node: SceneNode, color: HexColor, frequency: number, lightness: number }[])
    .sort((a, b) => {
      // Natural sort by layer name (handles numbers correctly)
      return naturalSort(a.node.name, b.node.name);
    });
  
  // Smart role assignment - dynamic number of colors
  for (let i = 0; i < sortedColors.length; i++) {
    const { node, color } = sortedColors[i];
    // First color is Base, others are Color1, Color2, Color3, etc.
    const role = i === 0 ? 'Base' : `Color${i}`;
    
    // Auto-assign role to node
    markRole(node, role);
    
    layerColors.push({
      nodeId: node.id,
      layerName: node.name,
      color,
      role
    });
  }
  
  return layerColors;
}

// =============================================================================
// MAIN PLUGIN LOGIC
// =============================================================================

// Show UI for all editor types
figma.showUI(__html__, { width: 320, height: 480 });

// Handle messages from UI
figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
  try {
    switch (msg.type) {
      case MessageType.ANALYZE_SELECTION:
        handleAnalyzeSelection();
        break;
        
      case MessageType.UPDATE_ROLE:
        await handleUpdateRole(msg.nodeId, msg.role);
        break;
        
      case MessageType.CREATE_TEMPLATE:
        await handleCreateTemplate(msg.templateName, msg.layerColors);
        break;
        
      case MessageType.APPLY_TEMPLATE:
        await handleApplyTemplate(msg.templateId, msg.colorChanges);
        break;
        
      case MessageType.BATCH_GENERATE:
        await handleBatchGenerate(msg.templateId, msg.variants);
        break;
        
      case MessageType.GET_TEMPLATES:
        await handleGetTemplates();
        break;
        
      default:
        figma.notify('Unknown message type', { error: true });
    }
  } catch (error: any) {
    figma.notify(`Error: ${error.message}`, { error: true });
    console.error('ArtyColors Error:', error);
  }
};

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

function handleAnalyzeSelection(): void {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.notify('Please select a component or group to analyze');
    return;
  }
  
  const root = selection[0];
  const layerColors = analyzeNodeColors(root);
  
  if (layerColors.length === 0) {
    figma.notify('No layers with solid fills found in selection');
    return;
  }
  
  // Send analysis results to UI
  figma.ui.postMessage({
    type: 'selection-analyzed',
    layerColors
  });
}

async function handleUpdateRole(nodeId: string, role: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
  if (node) {
    markRole(node, role);
    figma.notify(`Updated ${node.name} to role ${role}`);
  }
}

async function handleCreateTemplate(templateName: string, layerColors: LayerColorInfo[]): Promise<void> {
  if (layerColors.length === 0) {
    figma.notify('No colors to create template from');
    return;
  }
  
  // Find the base color
  const baseColor = layerColors.find(lc => lc.role === 'Base');
  if (!baseColor) {
    figma.notify('No Base color found. Please assign a Base role.');
    return;
  }
  
  const template: Template = {
    id: generateId(),
    name: templateName,
    colorNames: {},
    originalColors: {},
    roles: {}
  };
  
  // Store display names, original colors, and compute rules for each color
  for (const layerColor of layerColors) {
    const displayName = layerColor.displayName || layerColor.layerName;
    template.colorNames[layerColor.role] = displayName;
    template.originalColors[layerColor.role] = layerColor.color;
    
    if (layerColor.role !== 'Base') {
      template.roles[layerColor.role] = computeRelativeRule(baseColor.color, layerColor.color);
    }
  }
  
  // Store template
  await storeTemplate(template);
  
  figma.notify(`Template "${templateName}" created successfully`);
  await handleGetTemplates(); // Refresh UI
}

async function handleApplyTemplate(templateId: string, colorChanges: Record<string, HexColor>): Promise<void> {
  const template = await getTemplate(templateId);
  if (!template) {
    figma.notify('Template not found');
    return;
  }
  
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify('Please select nodes to apply template to');
    return;
  }
  
  // Extract base color (required for calculations)
  const baseColor = colorChanges['Base'];
  if (!baseColor) {
    figma.notify('Base color is required');
    return;
  }
  
  for (const root of selection) {
    applyTemplateToRootWithChanges(root, template, colorChanges);
  }
  
  figma.notify('Template applied successfully');
}

async function handleBatchGenerate(templateId: string, variants: VariantInfo[]): Promise<void> {
  const template = await getTemplate(templateId);
  if (!template) {
    figma.notify('Template not found');
    return;
  }

  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify('Please select a component to duplicate');
    return;
  }

  if (variants.length === 0) {
    figma.notify('Please add variants to generate');
    return;
  }

  const sourceComponent = selection[0];
  
  // Create grid of duplicates with auto-calculated layout
  const duplicates = duplicateInGrid(sourceComponent, variants.length);
  
  // Apply template with different anchor colors to each duplicate
  for (let i = 0; i < duplicates.length && i < variants.length; i++) {
    const duplicate = duplicates[i];
    const variant = variants[i];
    
    // Apply template using anchor-based system
    applyTemplateToRootWithAnchor(duplicate, template, variant.anchorColor, variant.hexColor);
    
    // Set the component name to the variant name
    duplicate.name = variant.name;
  }

  // Select all the new components
  figma.currentPage.selection = duplicates;
  figma.viewport.scrollAndZoomIntoView(duplicates);
  
  figma.notify(`Generated ${duplicates.length} variants in auto-grid layout`);
}

async function handleGetTemplates(): Promise<void> {
  const templates = await getAllTemplates();
  figma.ui.postMessage({
    type: 'templates-updated',
    templates
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function rgbToHex(color: RGB): HexColor {
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}` as HexColor;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Duplicate a node in an automatically calculated grid layout
 * @param node - The node to duplicate
 * @param count - Total number of copies to create
 * @param columns - Number of columns (optional, will auto-calculate if not provided)
 * @param gap - Gap between items in pixels (optional, defaults to 50)
 * @returns Array of duplicated nodes
 */
function duplicateInGrid(node: SceneNode, count: number, columns?: number, gap: number = 50): SceneNode[] {
  const duplicates: SceneNode[] = [];
  
  // Auto-calculate optimal columns if not provided
  if (!columns) {
    if (count <= 2) columns = 2;
    else if (count <= 4) columns = 2; 
    else if (count <= 9) columns = 3;
    else columns = 4; // Max 4 columns for readability
  }
  
  // Get node dimensions for positioning
  const nodeWidth = 'width' in node ? node.width : 100;
  const nodeHeight = 'height' in node ? node.height : 100;
  
  // Calculate grid positions
  for (let i = 0; i < count; i++) {
    const clone = node.clone();
    
    // Calculate grid position
    const row = Math.floor(i / columns);
    const col = i % columns;
    
    // Position the clone
    const x = node.x + col * (nodeWidth + gap);
    const y = node.y + row * (nodeHeight + gap);
    
    clone.x = x;
    clone.y = y;
    
    // Add to current page
    figma.currentPage.appendChild(clone);
    duplicates.push(clone);
  }
  
  return duplicates;
}

/**
 * Apply template to a component using anchor-based color changes
 * Similar to the frontend logic but using backend OKLCH calculations
 */
function applyTemplateToRootWithAnchor(root: SceneNode, template: Template, anchorRole: string, newAnchorColor: HexColor): void {
  const roleIndex = indexRoles(root);
  const originalAnchorColor = template.originalColors[anchorRole];
  
  if (!originalAnchorColor) {
    console.warn('No original color found for anchor role:', anchorRole);
    return;
  }
  
  // Calculate color shift in OKLCH space
  const originalOKLCH = hexToOKLCH(originalAnchorColor);
  const newOKLCH = hexToOKLCH(newAnchorColor);
  
  const shift = {
    L: newOKLCH.L - originalOKLCH.L,
    C: newOKLCH.C - originalOKLCH.C, 
    H: newOKLCH.H - originalOKLCH.H
  };
  
  // Handle hue wraparound
  if (shift.H > 180) shift.H -= 360;
  if (shift.H < -180) shift.H += 360;
  
  // Apply shift to all colors in the template
  Object.entries(template.originalColors).forEach(([role, originalColor]) => {
    let finalColor: HexColor;
    
    if (role === anchorRole) {
      // Use the exact anchor color
      finalColor = newAnchorColor;
    } else {
      // Apply proportional shift to this color
      const originalRoleOKLCH = hexToOKLCH(originalColor);
      const shiftedOKLCH = {
        L: Math.max(0, Math.min(1, originalRoleOKLCH.L + shift.L)),
        C: Math.max(0, originalRoleOKLCH.C + shift.C),
        H: (originalRoleOKLCH.H + shift.H + 360) % 360
      };
      
      finalColor = oklchToHex(gamutClamp(shiftedOKLCH));
    }
    
    // Apply color to nodes with this role
    const nodes = roleIndex[role] || [];
    for (const node of nodes) {
      applyColorToNode(node, finalColor);
    }
  });
  
  // Store template reference
  root.setPluginData('templateId', template.id);
  root.setPluginData('anchorColor', anchorRole);
  root.setPluginData('anchorValue', newAnchorColor);
}

function applyTemplateToRoot(root: SceneNode, template: Template, baseHex: HexColor): void {
  const roleIndex = indexRoles(root);
  
  // Apply base color
  for (const node of roleIndex.Base) {
    applyColorToNode(node, baseHex);
  }
  
  // Apply derived colors
  for (const [roleName, rule] of Object.entries(template.roles)) {
    if (rule) {
      const derivedColor = applyRule(rule, baseHex);
      const nodes = roleIndex[roleName as ColorRole];
      
      for (const node of nodes) {
        applyColorToNode(node, derivedColor);
      }
    }
  }
  
  // Store template reference on root
  root.setPluginData('templateId', template.id);
  root.setPluginData('baseColor', baseHex);
}

function applyTemplateToRootWithChanges(root: SceneNode, template: Template, colorChanges: Record<string, HexColor>): void {
  const roleIndex = indexRoles(root);
  const baseColor = colorChanges['Base'];
  
  // Calculate all colors based on user changes - start with all roles from template
  const finalColors: Record<string, HexColor> = {};
  
  // Initialize with base color
  finalColors['Base'] = baseColor;
  
  // Handle direct color assignments (user picked specific colors)
  Object.entries(colorChanges).forEach(([role, color]) => {
    finalColors[role] = color;
  });
  
  // Calculate derived colors for roles not explicitly set
  Object.entries(template.roles).forEach(([roleName, rule]) => {
    if (rule && !(roleName in colorChanges)) {
      // User didn't specify this color, so derive it from base
      finalColors[roleName] = applyRule(rule, baseColor);
    }
  });
  
  // Apply all final colors
  Object.entries(finalColors).forEach(([role, color]) => {
    const nodes = roleIndex[role] || [];
    for (const node of nodes) {
      applyColorToNode(node, color);
    }
  });
  
  // Store template reference on root
  root.setPluginData('templateId', template.id);
  root.setPluginData('baseColor', baseColor);
}

function applyColorToNode(node: SceneNode, hexColor: HexColor): void {
  if (!('fills' in node)) return;
  
  // Convert hex to RGB
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;
  
  const fills = [...(node.fills as readonly Paint[])];
  if (fills.length > 0 && fills[0].type === 'SOLID') {
    fills[0] = {
      ...fills[0],
      color: { r, g, b }
    };
    node.fills = fills;
  }
}

// Template storage functions
async function storeTemplate(template: Template): Promise<void> {
  const templates = await getAllTemplates();
  templates[template.id] = template;
  await figma.clientStorage.setAsync('templates', templates);
}

async function getTemplate(id: string): Promise<Template | null> {
  const templates = await getAllTemplates();
  return templates[id] || null;
}

async function getAllTemplates(): Promise<Record<string, Template>> {
  try {
    return await figma.clientStorage.getAsync('templates') || {};
  } catch {
    return {};
  }
}

console.log('ArtyColors plugin loaded successfully');
