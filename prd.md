Figma Color Relativity Plugin - Product Requirements & Engineering Specification
Product Requirements Document (PRD)
Executive Summary
A Figma plugin that maintains color relationships when modifying base colors in design systems, enabling designers to efficiently create color variants while preserving the relative luminance, saturation, and hue relationships between colors.
Problem Statement
Designers frequently need to create multiple color variations of the same component (e.g., different button states, theme variations). Currently, when changing a base color, all related colors (shadows, highlights, accents) must be manually adjusted to maintain their visual relationships, which is time-consuming and error-prone.
Solution Overview
Create a Figma plugin that:

Analyzes color relationships in a reference design
Allows designers to change a base color
Automatically adjusts all related colors to maintain their relative properties

Core Requirements
Functional Requirements
FR1: Color Role Definition

Users must be able to designate color roles within a design element:

Base: Primary/background color
A, B, C: Related colors (shadows, highlights, accents)


Support both explicit marking and automatic detection via layer naming conventions

FR2: Template Creation

Capture color relationships from a reference design
Store relative color rules using perceptually uniform color space (OKLCH)
Support multiple templates for different design patterns

FR3: Color Application

Apply stored relationships to new base colors
Maintain perceptual relationships for:

Lightness relativity
Chroma/saturation ratios
Hue angle deltas



FR4: Batch Processing

Generate multiple variants from a list of base colors
Support grid-based layout generation
Clone and transform multiple instances simultaneously

FR5: Update Existing Variants

Re-apply color relationships to already created variants
Support bulk updates across selections

Non-Functional Requirements
NFR1: Performance

Process color transformations in <100ms per element
Handle designs with 100+ layers efficiently
Minimize memory footprint

NFR2: Color Accuracy

Use OKLCH color space for perceptually accurate transformations
Implement gamut clamping to ensure valid RGB values
Preserve color intent across transformations

NFR3: User Experience

Intuitive UI with clear workflow steps
Real-time feedback on operations
Error handling with actionable messages

NFR4: Compatibility

Support all Figma node types with fill properties
Work with both Figma and FigJam
Handle nested components and groups

User Workflows
Primary Workflow: Creating Variants

Designer selects a reference design with multiple colors
Marks layers with color roles (Base, A, B, C)
Creates a template from the selection
Provides new base color(s)
Plugin generates variant(s) with adjusted colors

Secondary Workflow: Updating Existing Variants

Designer selects existing variant(s)
Provides new base color
Plugin updates all related colors maintaining relationships

Engineering Specification
Architecture Overview
┌─────────────────────────────────────────┐
│             UI Thread (ui.html)         │
│  - User interface                       │
│  - Color input handling                 │
│  - Template management UI               │
└────────────┬────────────────────────────┘
             │ PostMessage API
┌────────────▼────────────────────────────┐
│         Main Thread (code.js)           │
│  - Figma API interactions               │
│  - Color transformation engine          │
│  - Template storage (clientStorage)     │
│  - Node manipulation                    │
└─────────────────────────────────────────┘
Technical Decisions
Color Space: OKLCH

Rationale: Perceptually uniform, intuitive for relative adjustments
Benefits:

Linear lightness perception
Predictable chroma scaling
Hue-preserving transformations



Storage Strategy

Plugin Data: Role assignments on individual nodes
Client Storage: Template library (persistent across sessions)
Node Metadata: Template ID and base color on root containers

Relative Color Rules Structure
typescriptinterface RelativeRule {
  Lmode: 'lighten' | 'darken';  // Lightness adjustment direction
  k: number;                     // Lightness adjustment factor [0,1]
  Cmul: number;                   // Chroma multiplier
  Cabs: number | null;            // Absolute chroma (when base ~= 0)
  hDelta: number;                 // Hue angle delta in degrees
}
Implementation Guide
Phase 1: Core Infrastructure

Setup Plugin Manifest
json{
  "name": "ArtyColors",artycolors",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma", "figjam"]
}

Implement Color Conversion Functions

hexToOKLCH(): Convert hex to OKLCH
oklchToHex(): Convert OKLCH to hex with gamut clamping
gamutClamp(): Ensure colors are displayable in sRGB


Setup Message Passing

Establish bidirectional communication between UI and main thread
Define message types enum



Phase 2: Role Management

Implement Role Assignment
javascriptfunction markRole(node, role) {
  node.setPluginData('colorRole', role);
}

Add Auto-Detection
javascriptfunction inferRoleFromName(name) {
  // Check for [Base], [A], [B], [C] patterns
  // Fallback to name-based detection
}

Create Role Indexing
javascriptfunction indexRoles(root) {
  // Traverse node tree
  // Build role -> nodes mapping
}


Phase 3: Template System

Define Template Structure
javascriptinterface Template {
  id: string;
  name: string;
  roles: {
    A: RelativeRule;
    B: RelativeRule;
    C: RelativeRule;
  }
}

Implement Rule Calculation
javascriptfunction computeRelativeRule(baseColor, roleColor) {
  // Calculate L, C, h deltas
  // Return RelativeRule object
}

Add Template Persistence

Use figma.clientStorage for cross-session storage
Implement CRUD operations for templates



Phase 4: Color Application Engine

Implement Rule Application
javascriptfunction applyRule(rule, newBaseColor) {
  // Apply relative transformations
  // Return new color in hex
}

Add Batch Processing
javascriptfunction applyTemplateToRoot(root, template, baseHex) {
  // Get role-indexed nodes
  // Apply colors to each role
  // Save metadata
}


Phase 5: Variant Generation

Implement Grid Layout
javascriptfunction duplicateInGrid(node, count, columns, gap) {
  // Clone nodes
  // Position in grid
  // Return clones array
}

Add Batch Generation

Parse multiple base colors
Create grid of variants
Apply template to each



Phase 6: UI Implementation

Create Workflow UI

Role assignment buttons
Template management section
Single application controls
Batch generation interface


Add Visual Feedback

Loading states
Success/error notifications
Selection indicators



Best Practices & Optimizations
Performance Optimizations

Batch Operations

Group Figma API calls
Use figma.commitUndo() for atomic operations


Efficient Traversal
javascript// Use findAll with predicates
root.findAll(n => 'fills' in n)

Memory Management

Clone only necessary properties
Clear references after use



Error Handling

Validation Layers

Input validation (hex format)
Selection validation
Template existence checks


Graceful Degradation

Fallback for missing roles
Handle non-solid fills
Skip invalid nodes



Code Quality

Modular Structure

Separate color math utilities
Isolate Figma API interactions
Decouple UI from logic


Type Safety (if using TypeScript)
typescripttype ColorRole = 'Base' | 'A' | 'B' | 'C';
type HexColor = `#${string}`;


Testing Strategy
Unit Tests

Color conversion accuracy
Relative rule calculations
Gamut clamping edge cases

Integration Tests

Template creation/application
Role detection
Batch processing

User Acceptance Criteria

Colors maintain visual relationships
Performance meets <100ms target
UI provides clear feedback

Deployment Steps

Development Setup
bash# Create plugin structure
mkdir ArtyColors
cd ArtyColors
touch manifest.json code.js ui.html

Local Testing

Import plugin in Figma Desktop
Test with various design patterns
Validate color accuracy


Optimization

Minify code
Remove console.logs
Optimize color calculations


Publishing

Create plugin icon
Write documentation
Submit to Figma Community



Maintenance Considerations
Future Enhancements

Support for gradient fills
Custom color space options
Export/import template libraries
Integration with design tokens

Monitoring

Track performance metrics
Log error rates
Collect user feedback

Version Management

Semantic versioning
Changelog maintenance
Backward compatibility

Implementation Order

Week 1: Foundation

Set up plugin structure
Implement OKLCH color conversion
Basic message passing


Week 2: Core Features

Role assignment system
Template creation
Single color application


Week 3: Advanced Features

Batch processing
Grid generation
Update existing variants


Week 4: Polish & Deploy

UI refinements
Error handling
Testing & optimization
Documentation
Publishing