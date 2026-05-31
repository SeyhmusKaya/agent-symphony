; TypeScript / TSX queries
(function_declaration name: (identifier) @function.name) @function.def
(class_declaration name: (type_identifier) @class.name) @class.def
(interface_declaration name: (type_identifier) @interface.name) @interface.def
(type_alias_declaration name: (type_identifier) @type.name) @type.def
(enum_declaration name: (identifier) @enum.name) @enum.def
(method_definition name: (property_identifier) @method.name) @method.def
(method_signature name: (property_identifier) @method.name) @method.def
(call_expression function: (identifier) @call.name) @call.site
(call_expression function: (member_expression property: (property_identifier) @call.name)) @call.site
(import_statement source: (string (string_fragment) @import.path)) @import.stmt
(lexical_declaration (variable_declarator name: (identifier) @const.name)) @const.def
