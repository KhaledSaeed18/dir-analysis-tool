import * as path from 'path';
import { formatSize } from './utils';

export interface TreeNode {
    name: string;
    path: string;
    size?: number;
    isDirectory: boolean;
    children?: TreeNode[];
}

export class TreeViewGenerator {
    static generateTreeView(files: Array<{ path: string; size: number }>, rootPath: string): string {
        const tree = this.buildTree(files, rootPath);
        return this.renderTree(tree);
    }

    private static buildTree(files: Array<{ path: string; size: number }>, rootPath: string): TreeNode {
        const root: TreeNode = {
            name: path.basename(rootPath) || rootPath,
            path: rootPath,
            isDirectory: true,
            children: []
        };

        const nodeMap = new Map<string, TreeNode>();
        nodeMap.set(rootPath, root);

        // Sort files by path to ensure consistent ordering
        const sortedFiles = files.sort((a, b) => a.path.localeCompare(b.path));

        for (const file of sortedFiles) {
            const relativePath = path.relative(rootPath, file.path);
            if (!relativePath || relativePath === '.') continue;

            const parts = relativePath.split(path.sep);
            let currentPath = rootPath;
            let currentNode = root;

            // Create directory nodes
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                currentPath = path.join(currentPath, part);

                if (!nodeMap.has(currentPath)) {
                    const dirNode: TreeNode = {
                        name: part,
                        path: currentPath,
                        isDirectory: true,
                        children: []
                    };
                    nodeMap.set(currentPath, dirNode);
                    currentNode.children!.push(dirNode);
                }
                currentNode = nodeMap.get(currentPath)!;
            }

            // Create file node
            const fileName = parts[parts.length - 1];
            const fileNode: TreeNode = {
                name: fileName,
                path: file.path,
                size: file.size,
                isDirectory: false
            };
            currentNode.children!.push(fileNode);
        }

        // Sort children: directories first, then files, both alphabetically
        this.sortTreeNodes(root);
        return root;
    }

    private static sortTreeNodes(node: TreeNode): void {
        if (!node.children) return;

        node.children.sort((a, b) => {
            // Directories first
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;

            // Then alphabetically
            return a.name.localeCompare(b.name);
        });

        // Recursively sort children
        for (const child of node.children) {
            this.sortTreeNodes(child);
        }
    }

    private static renderTree(node: TreeNode, prefix: string = '', isLast: boolean = true, level: number = 0): string {
        const MAX_DEPTH = 10; // Prevent infinite recursion
        if (level > MAX_DEPTH) return '';

        let result = '';
        const connector = isLast ? '└── ' : '├── ';
        const sizeInfo = node.isDirectory ? '' : ` (${formatSize(node.size || 0)})`;
        const icon = node.isDirectory ? '📁' : '📄';

        result += `${prefix}${connector}${icon} ${node.name}${sizeInfo}\n`;

        if (node.children && node.children.length > 0) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');

            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childIsLast = i === node.children.length - 1;
                result += this.renderTree(child, newPrefix, childIsLast, level + 1);
            }
        }

        return result;
    }

    static generateCompactTreeView(files: Array<{ path: string; size: number }>, rootPath: string, maxFiles: number = 50): string {
        // Limit the number of files to display for performance
        const limitedFiles = files.slice(0, maxFiles);
        const tree = this.buildTree(limitedFiles, rootPath);

        let result = this.renderTree(tree);

        if (files.length > maxFiles) {
            result += `\n... and ${files.length - maxFiles} more files\n`;
        }

        return result;
    }
}
