"use client";
import React, { useState, useRef, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Dock } from 'lucide-react';

// Decodes a base64 string into an ArrayBuffer.
const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Converts raw PCM audio data into a playable WAV format.
const pcmToWav = (pcmData, sampleRate) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const pcmLength = pcmData.length * 2; // 16-bit PCM

    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmLength, true);
    writeString(view, 8, 'WAVE');
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 for mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmLength, true);

    return new Blob([header, pcmData], { type: 'audio/wav' });
};


// Main App Component
const App = () => {
    // Refs for canvas and its context
    const canvasRef = useRef(null);
    const contextRef = useRef(null);

    // State for drawing properties and actions
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#000000');
    const [lineWidth, setLineWidth] = useState(5);
    const [backgroundColor, setBackgroundColor] = useState('#FFFFFF');
    const [tool, setTool] = useState('pencil'); // 'pencil', 'eraser', 'line', 'rectangle', 'circle', 'move', 'fill'

    // State for shape and move tools
    const [startPos, setStartPos] = useState(null);
    const [canvasSnapshot, setCanvasSnapshot] = useState(null);
    const [pastingImage, setPastingImage] = useState(null); // For move tool

    // State for Undo functionality
    const [history, setHistory] = useState([]);
    const [historyStep, setHistoryStep] = useState(-1);


    // --- Canvas Initialization and Effects ---
    useEffect(() => {
        const canvas = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        const context = canvas.getContext('2d');
        context.scale(dpr, dpr);
        context.lineCap = 'round';
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        contextRef.current = context;
        clearCanvas();

        const handleResize = () => {
            // Save current drawing
            const imageDataUrl = canvas.toDataURL();
            const newRect = canvas.getBoundingClientRect();
            canvas.width = newRect.width * dpr;
            canvas.height = newRect.height * dpr;
            context.scale(dpr, dpr);
            
            // Restore drawing
            const img = new Image();
            img.src = imageDataUrl;
            img.onload = () => {
                context.drawImage(img, 0, 0, newRect.width, newRect.height);
            };

            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.lineCap = 'round';
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (contextRef.current) {
            contextRef.current.lineWidth = lineWidth;
            contextRef.current.strokeStyle = color;
            contextRef.current.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        }
    }, [color, lineWidth, tool]);

    useEffect(() => {
        if (contextRef.current && historyStep < 0) clearCanvas();
    }, [backgroundColor]);

    // Redraw canvas on undo
    useEffect(() => {
        if (historyStep >= 0 && history[historyStep]) {
            const canvas = canvasRef.current;
            const context = contextRef.current;
            const dpr = window.devicePixelRatio || 1;
            const img = new Image();
            img.src = history[historyStep];
            img.onload = () => {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
            };
        }
    }, [historyStep]);
    
    // --- History Management ---
    const saveToHistory = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const newHistory = history.slice(0, historyStep + 1);
        newHistory.push(canvas.toDataURL('image/png'));
        setHistory(newHistory);
        setHistoryStep(newHistory.length - 1);
    };

    const handleUndo = () => {
        if (historyStep > 0) {
            setHistoryStep(prev => prev - 1);
        }
    };

    // --- Coordinate and Event Handlers ---
    const getCoords = (event) => {
        const { clientX, clientY } = event.touches ? event.touches[0] : event;
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const handleMouseDown = (event) => {
        if (pastingImage) {
            pasteImage(getCoords(event));
            return;
        }
        if (tool === 'fill') {
            handleFill(event);
            return;
        }
        startDrawing(event);
    };
    
    const handleMouseMove = (event) => {
        if (pastingImage) {
            const currentPos = getCoords(event);
            contextRef.current.putImageData(canvasSnapshot, 0, 0);
            contextRef.current.drawImage(pastingImage.image, currentPos.x - pastingImage.width / 2, currentPos.y - pastingImage.height / 2);
            return;
        }
        draw(event);
    };

    const startDrawing = (event) => {
        const pos = getCoords(event);
        setIsDrawing(true);
        contextRef.current.beginPath();
        setStartPos(pos);
        
        if (tool === 'pencil' || tool === 'eraser') {
            contextRef.current.moveTo(pos.x, pos.y);
        } else { // For shapes, move
            const canvas = canvasRef.current;
            setCanvasSnapshot(contextRef.current.getImageData(0, 0, canvas.width, canvas.height));
        }
    };
    
    const draw = (event) => {
        if (!isDrawing || !startPos) return;
        const currentPos = getCoords(event);
    
        if (tool === 'pencil' || tool === 'eraser') {
            contextRef.current.lineTo(currentPos.x, currentPos.y);
            contextRef.current.stroke();
        } else if (canvasSnapshot) {
            contextRef.current.putImageData(canvasSnapshot, 0, 0);
            contextRef.current.beginPath();

            if (tool === 'line') {
                contextRef.current.moveTo(startPos.x, startPos.y);
                contextRef.current.lineTo(currentPos.x, currentPos.y);
                contextRef.current.stroke();
            } else if (tool === 'rectangle' || tool === 'move') {
                const rectWidth = currentPos.x - startPos.x;
                const rectHeight = currentPos.y - startPos.y;
                contextRef.current.rect(startPos.x, startPos.y, rectWidth, rectHeight);
                 if (tool === 'move') {
                    contextRef.current.setLineDash([5, 10]);
                    contextRef.current.strokeStyle = '#000000';
                    contextRef.current.lineWidth = 1;
                    contextRef.current.stroke();
                    contextRef.current.setLineDash([]);
                    contextRef.current.strokeStyle = color;
                    contextRef.current.lineWidth = lineWidth;
                } else {
                    contextRef.current.stroke();
                }
            } else if (tool === 'circle') {
                const radius = Math.sqrt(Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.y - startPos.y, 2));
                contextRef.current.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
                contextRef.current.stroke();
            }
        }
    };

    const stopDrawing = (event) => {
        if (!isDrawing) return;
        const endPos = getCoords(event);
        let actionTaken = false;

        if (tool === 'line' || tool === 'rectangle' || tool === 'circle') {
            contextRef.current.putImageData(canvasSnapshot, 0, 0);
            draw({ clientX: endPos.x + canvasRef.current.offsetLeft, clientY: endPos.y + canvasRef.current.offsetTop});
            actionTaken = true;
        } else if (tool === 'pencil' || tool === 'eraser') {
             actionTaken = true;
        } else if (tool === 'move') {
            handleMoveSelection(endPos);
        }
    
        contextRef.current.closePath();
        setStartPos(null);
        setCanvasSnapshot(null);
        setIsDrawing(false);

        if (actionTaken) {
            saveToHistory();
        }
    };

    // --- Tool-Specific Functions ---
    const handleMoveSelection = (endPos) => {
        const rect = {
            x: Math.min(startPos.x, endPos.x),
            y: Math.min(startPos.y, endPos.y),
            width: Math.abs(startPos.x - endPos.x),
            height: Math.abs(startPos.y - endPos.y)
        };
        if (rect.width < 1 || rect.height < 1) return;

        const dpr = window.devicePixelRatio || 1;
        const selectedImageData = contextRef.current.getImageData(rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr);
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = rect.width * dpr;
        tempCanvas.height = rect.height * dpr;
        tempCanvas.getContext('2d').putImageData(selectedImageData, 0, 0);
        
        const image = new Image();
        image.src = tempCanvas.toDataURL();
        image.onload = () => {
            contextRef.current.putImageData(canvasSnapshot, 0, 0);
            contextRef.current.fillStyle = backgroundColor;
            contextRef.current.fillRect(rect.x, rect.y, rect.width, rect.height);
            setCanvasSnapshot(contextRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));
            setPastingImage({ image, width: rect.width, height: rect.height });
        };
    };
    
    const pasteImage = (pos) => {
        contextRef.current.drawImage(pastingImage.image, pos.x - pastingImage.width / 2, pos.y - pastingImage.height / 2);
        setPastingImage(null);
        setTool('pencil');
        saveToHistory();
    };

    const handleFill = (event) => {
        const canvas = canvasRef.current;
        const context = contextRef.current;
        const dpr = window.devicePixelRatio || 1;
        const { x, y } = getCoords(event);
        const startX = Math.floor(x * dpr);
        const startY = Math.floor(y * dpr);

        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : null;
        };

        const fillColorRgb = hexToRgb(color);
        if (!fillColorRgb) return;

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        const getPixel = (px, py) => {
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
                return [-1, -1, -1, -1];
            }
            const offset = (py * canvas.width + px) * 4;
            return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
        };

        const startColor = getPixel(startX, startY);
        const fillColor = [...fillColorRgb, 255];

        if (startColor.every((c, i) => c === fillColor[i])) return;

        const queue = [[startX, startY]];
        while (queue.length > 0) {
            const [px, py] = queue.shift();
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            
            const currentColor = getPixel(px, py);
            if (currentColor.every((c, i) => c === startColor[i])) {
                const offset = (py * canvas.width + px) * 4;
                data[offset] = fillColor[0];
                data[offset + 1] = fillColor[1];
                data[offset + 2] = fillColor[2];
                data[offset + 3] = fillColor[3];

                queue.push([px + 1, py]);
                queue.push([px - 1, py]);
                queue.push([px, py + 1]);
                queue.push([px, py - 1]);
            }
        }
        context.putImageData(imageData, 0, 0);
        saveToHistory();
    };


    // --- Control Functions ---
    const clearCanvas = () => {
        const canvas = canvasRef.current;
        const context = contextRef.current;
        const dpr = window.devicePixelRatio || 1;
        context.fillStyle = backgroundColor;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        saveToHistory();
        toast.info('Canvas cleared!', { position: 'top-center', autoClose: 2000 });
    };

    const saveDrawing = () => {
        const canvas = canvasRef.current;
        const image = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = image;
        link.download = 'whiteboard-art.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Drawing saved!', { position: 'top-center', autoClose: 2000 });
    };

    
    // --- UI Components ---
    const ToolButton = ({ name, icon, currentTool, setTool }) => {
        const isActive = currentTool === name;
        return (
            <button onClick={() => setTool(name)} className={`p-2 rounded-lg transition-colors duration-200 ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`} title={name.charAt(0).toUpperCase() + name.slice(1)}>
                {icon}
            </button>
        );
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center font-sans p-4">
            <ToastContainer />
            <div className="w-full max-w-6xl">
                <h1 className="flex justify-center items-center gap-2 text-2xl font-semibold text-center text-gray-800 mb-4"><Dock size={32} /> I-Board - <span className='font-normal text-2xl'>A Smart Whiteboard</span>  </h1>
                <div className="bg-white rounded-lg shadow-lg p-4 mb-4 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
                        <div className="flex items-center gap-2 border-r pr-4">
                            <ToolButton name="pencil" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>} />
                            <ToolButton name="eraser" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7Z"/><path d="M22 21H7"/><path d="m5 12 5 5"/></svg>} />
                            <ToolButton name="line" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>} />
                            <ToolButton name="rectangle" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>} />
                            <ToolButton name="circle" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>} />
                            <ToolButton name="fill" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22A10 10 0 0 0 22 12c0-5-4-9-9-9-2.5 0-4.8 1-6.5 2.5L2 10.3c.2.2.3.4.3.7 0 .5-.4.9-.9.9H.2c-.3 0-.5-.2-.5-.5v-1.7c0-.3.2-.5.5-.5 0 0 .1 0 .1 0 .2 0 .4.1.6.3L2 9.5l.7-1.3C4.2 6.6 6.1 5 8.3 4.1c.4-.2.9.1.9.6v1.8c0 .3-.2.5-.5.5h-1.8c-.3 0-.5-.2-.5-.5 0-.3.2-.5.5-.5h.3L6 9l-2.6 1.4c-.3.1-.4.5-.3.8.1.3.5.4.8.3L6 10.8V12c0 3.3 2.7 6 6 6Z"/><path d="m18.5 2.6-2.9 2.9a2 2 0 0 0 0 2.8l2.9 2.9c.8.8 2 .8 2.8 0l2.9-2.9a2 2 0 0 0 0-2.8l-2.9-2.9c-.8-.7-2-.7-2.8 0Z"/></svg>} />
                            <ToolButton name="move" setTool={setTool} currentTool={tool} icon={<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>} />
                        </div>
                         <div className="flex flex-col items-center">
                            <label htmlFor="colorPicker" className="text-sm font-medium text-gray-700 mb-1">Color</label>
                            <input id="colorPicker" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 p-1 border border-gray-300 rounded-md cursor-pointer"/>
                        </div>
                        <div className="flex flex-col items-center">
                            <label htmlFor="bgColorPicker" className="text-sm font-medium text-gray-700 mb-1">Background</label>
                            <input id="bgColorPicker" type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-10 h-10 p-1 border border-gray-300 rounded-md cursor-pointer"/>
                        </div>
                        <div className="flex flex-col items-center">
                            <label htmlFor="lineWidth" className="text-sm font-medium text-gray-700 mb-1">Size: {lineWidth}</label>
                            <input type="range" id="lineWidth" min="1" max="50" value={lineWidth} onChange={(e) => setLineWidth(e.target.value)} className="w-36 cursor-pointer"/>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={handleUndo} disabled={historyStep <= 0} className="px-4 py-2 bg-gray-500 text-white font-semibold rounded-lg shadow-md hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed">Undo</button>
                            <button onClick={clearCanvas} className="px-4 py-2 bg-red-500 text-white font-semibold rounded-lg shadow-md hover:bg-red-600">Clear</button>
                            <button onClick={saveDrawing} className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600">Save</button>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-xl overflow-hidden">
                     <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onMouseMove={handleMouseMove}
                        onTouchStart={handleMouseDown}
                        onTouchEnd={stopDrawing}
                        onTouchMove={handleMouseMove}
                        className="w-full h-[55vh] md:h-[65vh] cursor-crosshair"
                    />
                </div>
            </div>
            <h2 className='mt-6 text-gray-800 font-bold text-sm'>Made by PIYUSH SINGH</h2>
        </div>
    );
};

export default App;