export interface TreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    isEntrypoint: boolean;
    children: TreeNode[];
}

export function buildTree(
    files: Map<string, string>,
    emptyDirs: Set<string>,
    entrypoints: Set<string>,
): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();

    function getOrCreateDir(dirPath: string): TreeNode {
        let node = nodeMap.get(dirPath);
        if (node) return node;

        node = {
            name: basename(dirPath),
            path: dirPath,
            isDirectory: true,
            isEntrypoint: false,
            children: [],
        };
        nodeMap.set(dirPath, node);

        const parent = dirname(dirPath);
        if (parent !== "") {
            const parentNode = getOrCreateDir(parent);
            parentNode.children.push(node);
        }

        return node;
    }

    for (const dir of emptyDirs) {
        getOrCreateDir(dir);
    }

    for (const filePath of files.keys()) {
        const fileNode: TreeNode = {
            name: basename(filePath),
            path: filePath,
            isDirectory: false,
            isEntrypoint: entrypoints.has(filePath),
            children: [],
        };
        nodeMap.set(filePath, fileNode);

        const parent = dirname(filePath);
        if (parent !== "") {
            const parentNode = getOrCreateDir(parent);
            parentNode.children.push(fileNode);
        }
    }

    for (const node of nodeMap.values()) {
        if (node.isDirectory) {
            sortChildren(node.children);
        }
    }

    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
        const parent = dirname(node.path);
        if (parent === "") {
            roots.push(node);
        }
    }

    sortChildren(roots);
    return roots;
}

function sortChildren(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

export function dirname(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.substring(0, i);
}

export function basename(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.substring(i + 1);
}

export function joinPath(...parts: string[]): string {
    return parts.filter((p) => p !== "").join("/");
}

export function isDescendant(parent: string, child: string): boolean {
    return child.startsWith(parent + "/");
}
