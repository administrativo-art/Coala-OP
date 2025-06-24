# **App Name**: Smart Converter

## Core Features:

- Main Menu: Initial menu screen with 'Standard Conversion' and 'Inventory Conversion' buttons.
- Standard Conversion: Screen for converting standard units with category, value, 'From', and 'To' selectors, and a conversion result.
- Inventory Conversion: Screen to convert inventory units. Product selector, 'Manage Products' button, input value, and conversion selectors with package options are required. Generates conversion result.
- Product Management: Modal window to list, edit, and delete registered products from localStorage.
- Add Product: Functionality to add a new product, including base name, category, package size, and unit; automatically generates full product names using user-defined parameters.
- Custom Delete Confirmation: Modal dialog to confirm deleting the item; must not use browser's default alerts/confirms.
- Local Storage: Use local storage to persistently save registered products list with name, package size, and unit of measure.

## Style Guidelines:

- Primary color: Deep blue (#3F51B5) to convey reliability.
- Background color: Light gray (#F0F2F5) for a clean interface.
- Accent color: Teal (#009688) for buttons and active states.
- Body and headline font: 'PT Sans' (sans-serif) for a modern, accessible style.
- Use clear and intuitive icons from a set like FontAwesome for main actions.
- Employ a simple layout that provides adequate whitespace; focus on displaying only the information that the user requested, such as units, values, results.
- Smooth transitions for modal windows opening and closing.