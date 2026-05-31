; C# queries (also used for .razor @code blocks)
(method_declaration name: (identifier) @method.name) @method.def
(class_declaration name: (identifier) @class.name) @class.def
(interface_declaration name: (identifier) @interface.name) @interface.def
(struct_declaration name: (identifier) @struct.name) @struct.def
(enum_declaration name: (identifier) @enum.name) @enum.def
(record_declaration name: (identifier) @class.name) @class.def
(invocation_expression function: (identifier) @call.name) @call.site
(invocation_expression function: (member_access_expression name: (identifier) @call.name)) @call.site
(using_directive (qualified_name) @import.path) @import.stmt
(using_directive (identifier) @import.path) @import.stmt
