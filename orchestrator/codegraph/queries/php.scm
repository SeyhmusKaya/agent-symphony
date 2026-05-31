; PHP queries
(function_definition name: (name) @function.name) @function.def
(method_declaration name: (name) @method.name) @method.def
(class_declaration name: (name) @class.name) @class.def
(interface_declaration name: (name) @interface.name) @interface.def
(trait_declaration name: (name) @trait.name) @trait.def
(function_call_expression function: (name) @call.name) @call.site
(member_call_expression name: (name) @call.name) @call.site
(scoped_call_expression name: (name) @call.name) @call.site
(namespace_use_clause (qualified_name) @import.path) @import.stmt
(namespace_use_clause (name) @import.path) @import.stmt
