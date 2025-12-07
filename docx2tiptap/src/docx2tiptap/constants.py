"""
Constants used throughout the docx2tiptap library.

Centralizes magic numbers and configuration values.
"""

# Maximum depth for resolving style inheritance chains.
# Word styles can inherit from other styles (basedOn attribute).
# We iterate up to this many times to resolve all inheritance.
MAX_STYLE_INHERITANCE_DEPTH = 10

# Maximum nesting levels supported for lists.
# Word supports numbered/bulleted lists with multiple indent levels.
# We track counters for up to this many levels.
MAX_LIST_NESTING_LEVELS = 10
