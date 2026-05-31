; Python queries
(function_definition name: (identifier) @function.name) @function.def
(class_definition name: (identifier) @class.name) @class.def
(call function: (identifier) @call.name) @call.site
(call function: (attribute attribute: (identifier) @call.name)) @call.site
(import_statement name: (dotted_name) @import.path) @import.stmt
(import_from_statement module_name: (dotted_name) @import.path) @import.stmt
