; JavaScript / JSX queries
(function_declaration name: (identifier) @function.name) @function.def
(class_declaration name: (identifier) @class.name) @class.def
(method_definition name: (property_identifier) @method.name) @method.def
(call_expression function: (identifier) @call.name) @call.site
(call_expression function: (member_expression property: (property_identifier) @call.name)) @call.site
(import_statement source: (string (string_fragment) @import.path)) @import.stmt
(variable_declarator name: (identifier) @const.name value: (arrow_function)) @const.def
