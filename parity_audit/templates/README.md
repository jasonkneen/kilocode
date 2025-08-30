# Kilocode CLI/Extension Parity Audit Templates

## Data Entry Rules

### Status Codes

- **✅ Complete Parity**: Feature works identically in CLI and extension
- **🔄 Needs CLI Adaptation**: Feature exists but requires CLI-appropriate adaptation
- **❌ Missing in CLI**: Feature exists in extension but not implemented in CLI
- **🚫 Incompatible**: GUI-only feature that cannot be meaningfully adapted to CLI
- **🆕 CLI-only Advantage**: Feature that only makes sense in CLI context

### Priority Levels

- **P0 Critical**: Must-have for basic parity
- **P1 Important**: Should-have for strong parity
- **P2 Nice-to-have**: Could-have for complete parity
- **P3 Future**: Won't-have in current roadmap

### Effort Scale

- **S (Small)**: 1-2 days of work
- **M (Medium)**: 3-5 days of work
- **L (Large)**: 1-2 weeks of work
- **XL (Extra Large)**: 3+ weeks of work

### Categories

1. **providers**: AI provider integrations (OpenAI, Anthropic, etc.)
2. **tools**: Core functionality tools (file ops, search, etc.)
3. **ui_ux**: User interface and experience features
4. **configuration**: Settings, profiles, and configuration management
5. **advanced**: Advanced features (browser automation, multimodal, etc.)

## Templates

### parity_matrix_schema.json

JSON schema for the main parity tracking matrix

### provider_capabilities_template.json

Template for capturing provider-specific capabilities

### tool_capabilities_template.json

Template for capturing tool metadata and constraints

### config_matrix_template.json

Template for configuration option mapping

## Audit Process

1. **Automated Inventory**: Extract features from both extension and CLI codebases
2. **Manual Audit**: Review GUI-specific features and adaptation strategies
3. **Normalization**: Map extension features to CLI equivalents
4. **Matrix Assembly**: Combine all data into master parity matrix
5. **Validation**: Verify completeness and accuracy of mappings

## File Naming Conventions

- Use snake_case for all file names
- Include timestamp in generated data files: `YYYY-MM-DD_HH-MM`
- Use semantic versioning for templates: `v1.0.0`
