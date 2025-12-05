# What You Need to Convert JavaScript Screens

## Information Needed

To convert your JavaScript screens to match this TypeScript project, please provide:

### 1. **Source Files**
- [ ] JavaScript component files (`.js` or `.jsx`)
- [ ] CSS/styling files (if any)
- [ ] API/service files (if any)

### 2. **Screen Information**
For each screen you want to add:
- [ ] Screen name/purpose
- [ ] Route path you want (e.g., `/campaign/list`, `/campaign/create`)
- [ ] Menu location (which menu group: master, txn, reports, campaign)
- [ ] Whether it's a list, form, or other type of screen

### 3. **API Information** (if applicable)
- [ ] API endpoints used
- [ ] Request/response data structure
- [ ] HTTP methods (GET, POST, PUT, DELETE, etc.)

### 4. **Dependencies**
- [ ] Any external libraries used (check if they're in `package.json`)
- [ ] Any custom utilities or helpers

## What I'll Do

Once you provide the files, I will:

1. ✅ Convert JavaScript to TypeScript
2. ✅ Add proper TypeScript types
3. ✅ Create API client file following project pattern
4. ✅ Update imports and paths
5. ✅ Add routes to `App.tsx`
6. ✅ Add navigation links to `Sidebar.tsx`
7. ✅ Ensure error handling matches project standards
8. ✅ Apply project styling patterns
9. ✅ Test for TypeScript compilation errors

## Quick Start Options

### Option 1: Share Your Files
Just share the JavaScript files and I'll convert them!

### Option 2: Tell Me What You Need
Tell me:
- What screens you want to add
- What they should do
- I can create the structure and you can fill in the logic

### Option 3: Step-by-Step
We can convert one screen at a time, and I'll guide you through each step.

## Current Project Stack

- **Framework**: React 19.1.1
- **Language**: TypeScript 5.8.3
- **Routing**: React Router DOM 7.9.1
- **HTTP Client**: Axios (via custom `http` wrapper)
- **Build Tool**: Vite 7.1.6
- **Styling**: CSS (with theme support)

## Common Conversions

| JavaScript | TypeScript |
|------------|------------|
| `function MyComp(props)` | `function MyComp({ prop1, prop2 }: MyCompProps)` |
| `const [data, setData] = useState(null)` | `const [data, setData] = useState<DataType \| null>(null)` |
| `axios.get('/api/endpoint')` | `http.get<ResponseType>('/endpoint').then(r => r.data)` |
| `import { something } from '../../../utils'` | `import { something } from '@/utils'` |

