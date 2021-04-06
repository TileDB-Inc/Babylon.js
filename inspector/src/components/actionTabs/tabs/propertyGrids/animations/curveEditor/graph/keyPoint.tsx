import { Vector2 } from "babylonjs/Maths/math.vector";
import { Observer } from "babylonjs/Misc/observable";
import { Nullable } from "babylonjs/types";
import * as React from "react";
import { Context } from "../context";
import { Curve } from "./curve";

const keyInactive = require("../assets/keyInactiveIcon.svg") as string;
const keySelected = require("../assets/keySelectedIcon.svg") as string;
const keyActive = require("../assets/keyActiveIcon.svg") as string;

interface IKeyPointComponentProps {
    x: number;
    y: number;
    getPreviousX: () => Nullable<number>;
    getNextX: () => Nullable<number>;
    invertX:(x: number) => number;
    invertY:(y: number) => number;
    convertX:(x: number) => number;
    convertY:(y: number) => number;
    nextX?: number;
    scale: number;
    keyId: number;
    curve: Curve;
    context: Context;
    channel: string;
    onFrameValueChanged: (value: number) => void;
    onKeyValueChanged: (value: number) => void;
}

interface IKeyPointComponentState {
    selectedState: SelectionState;    
    x: number;
    y: number;
}

export enum SelectionState {
    None,
    Selected,
    Siblings
}

enum ControlMode {
    None,
    Key,
    TangentLeft,
    TangentRight
}

export class KeyPointComponent extends React.Component<
IKeyPointComponentProps,
IKeyPointComponentState
> {    
    private _onActiveKeyPointChangedObserver: Nullable<Observer<void>>;
    private _onActiveKeyFrameChangedObserver: Nullable<Observer<number>>;
    private _onFrameManuallyEnteredObserver: Nullable<Observer<number>>;
    private _onValueManuallyEnteredObserver: Nullable<Observer<number>>;
    private _onMainKeyPointSetObserver: Nullable<Observer<void>>;
    private _onMainKeyPointMovedObserver: Nullable<Observer<void>>;
    private _onSelectionRectangleMovedObserver: Nullable<Observer<DOMRect>>;

    private _pointerIsDown: boolean;
    private _sourcePointerX: number;
    private _sourcePointerY: number;

    private _offsetXToMain: number;
    private _offsetYToMain: number;
    
    private _svgHost: React.RefObject<SVGSVGElement>;
    private _keyPointSVG: React.RefObject<SVGImageElement>;

    private _controlMode = ControlMode.None;

    private _storedLengthin: number;
    private _storedLengthOut: number;

    private _inVec: Vector2;
    private _outVec: Vector2;

    constructor(props: IKeyPointComponentProps) {
        super(props);

        this.state = { selectedState: SelectionState.None, x: this.props.x, y: this.props.y };
        
        this._svgHost = React.createRef();
        this._keyPointSVG = React.createRef();

        this._onSelectionRectangleMovedObserver = this.props.context.onSelectionRectangleMoved.add(rect1 => {
            const rect2 = this._svgHost.current!.getBoundingClientRect();
            var overlap = !(rect1.right < rect2.left || 
                rect1.left > rect2.right || 
                rect1.bottom < rect2.top || 
                rect1.top > rect2.bottom);

            if (!this.props.context.activeKeyPoints) {
                this.props.context.activeKeyPoints = [];
            }

            let index = this.props.context.activeKeyPoints.indexOf(this);
            if (overlap) {
                if (index === -1) {
                    this.props.context.activeKeyPoints.push(this);

                    this.props.context.onActiveKeyPointChanged.notifyObservers();
                }
            } else {
                if (index > -1) {
                    this.props.context.activeKeyPoints.splice(index, 1);
                    this.props.context.onActiveKeyPointChanged.notifyObservers();
                }
            }
        });
        
        this._onMainKeyPointSetObserver = this.props.context.onMainKeyPointSet.add(() => {
            if (!this.props.context.mainKeyPoint || this.props.context.mainKeyPoint === this) {
                return;
            }
            this._offsetXToMain = this.state.x - this.props.context.mainKeyPoint?.state.x;
            this._offsetYToMain = this.state.y - this.props.context.mainKeyPoint?.state.y;
        });

        this._onMainKeyPointMovedObserver = this.props.context.onMainKeyPointMoved.add(() => {
            let mainKeyPoint = this.props.context.mainKeyPoint;
            if (mainKeyPoint === this || !mainKeyPoint) {
                return;
            }

            if (this.state.selectedState !== SelectionState.None && this.props.keyId !== 0) { // Move frame for every selected or siblins
                let newFrameValue = mainKeyPoint.state.x + this._offsetXToMain;

                this.setState({x: newFrameValue});
                this.props.onFrameValueChanged(this.props.invertX(newFrameValue));
            }
            
            if (this.state.selectedState === SelectionState.Selected) { // Move value only for selected
                let newY = mainKeyPoint.state.y + this._offsetYToMain;
                this.setState({y: newY});            
                this.props.onKeyValueChanged(this.props.invertY(newY));
            }
        });

        this._onActiveKeyPointChangedObserver = this.props.context.onActiveKeyPointChanged.add(() => {
            const isSelected = this.props.context.activeKeyPoints?.indexOf(this) !== -1;
            
            if (!isSelected && this.props.context.activeKeyPoints) {
                let curve = this.props.curve;
                let state = SelectionState.None;

                for (let activeKeyPoint of this.props.context.activeKeyPoints) {
                    if (activeKeyPoint.props.keyId === this.props.keyId && curve !== activeKeyPoint.props.curve) {
                        state = SelectionState.Siblings;
                        break;
                    }
                }

                this.setState({selectedState: state});

            } else {
                this.setState({selectedState: SelectionState.Selected});
            }

            if (isSelected) {
                this.props.context.onFrameSet.notifyObservers(this.props.invertX(this.state.x));
                this.props.context.onValueSet.notifyObservers(this.props.invertY(this.state.y));
            }
        });

        this._onActiveKeyFrameChangedObserver = this.props.context.onActiveKeyFrameChanged.add(newFrameValue => {
            if (this.state.selectedState !== SelectionState.Siblings || this.props.context.mainKeyPoint) {
                return;
            }

            this.setState({x: newFrameValue});
            this.props.onFrameValueChanged(this.props.invertX(newFrameValue));
        });

        // Values set via the UI
        this._onFrameManuallyEnteredObserver = this.props.context.onFrameManuallyEntered.add(newValue => {
            if (this.state.selectedState === SelectionState.None) {
                return;
            }

            let newX = this.props.convertX(newValue);

            // Checks
            let previousX = this.props.getPreviousX();
            let nextX = this.props.getNextX();
            if (previousX !== null) {
                newX = Math.max(previousX, newX);
            }
    
            if (nextX !== null) {
                newX = Math.min(nextX, newX);
            }

            const frame = this.props.invertX(newX);
            this.setState({x: newX});
            this.props.onFrameValueChanged(frame);    
        });

        this._onValueManuallyEnteredObserver = this.props.context.onValueManuallyEntered.add(newValue => {
            if (this.state.selectedState !== SelectionState.Selected) {
                return;
            }

            let newY = this.props.convertY(newValue);
            this.setState({y: newY});            
            this.props.onKeyValueChanged(newValue);
        });
    }

    componentWillUnmount() {

        if (this._onSelectionRectangleMovedObserver) {
            this.props.context.onSelectionRectangleMoved.remove(this._onSelectionRectangleMovedObserver);
        }

        if (this._onMainKeyPointSetObserver) {
            this.props.context.onMainKeyPointSet.remove(this._onMainKeyPointSetObserver);
        }

        if (this._onMainKeyPointMovedObserver) {
            this.props.context.onMainKeyPointMoved.remove(this._onMainKeyPointMovedObserver);
        }

        if (this._onActiveKeyPointChangedObserver) {
            this.props.context.onActiveKeyPointChanged.remove(this._onActiveKeyPointChangedObserver);
        }

        if (this._onActiveKeyFrameChangedObserver) {
            this.props.context.onActiveKeyFrameChanged.remove(this._onActiveKeyFrameChangedObserver);
        }

        if (this._onFrameManuallyEnteredObserver) {
            this.props.context.onFrameManuallyEntered.remove(this._onFrameManuallyEnteredObserver);
        }

        if (this._onValueManuallyEnteredObserver) {
            this.props.context.onValueManuallyEntered.remove(this._onValueManuallyEnteredObserver);
        }
    }

    shouldComponentUpdate(newProps: IKeyPointComponentProps, newState: IKeyPointComponentState) {
        if (newProps !== this.props) {
            newState.x = newProps.x;
            newState.y = newProps.y;
        }

        return true;
    }

    private _select(allowMultipleSelection: boolean) {
        if (!this.props.context.activeKeyPoints) {
            return;
        }

        let index = this.props.context.activeKeyPoints.indexOf(this);
        if (index === -1) {            
            if (!allowMultipleSelection) {
                this.props.context.activeKeyPoints = [];
            }
            this.props.context.activeKeyPoints.push(this);

            if (this.props.context.activeKeyPoints.length > 1 ) { // multi selection is engaged
                this.props.context.mainKeyPoint = this;
                this.props.context.onMainKeyPointSet.notifyObservers();   
            } else {
                this.props.context.mainKeyPoint = null;
            }
        } else {
            if (allowMultipleSelection) {
                this.props.context.activeKeyPoints.splice(index, 1);
                this.props.context.mainKeyPoint = null;
            } else {
                if (this.props.context.activeKeyPoints.length > 1 ) {
                    this.props.context.mainKeyPoint = this;
                    this.props.context.onMainKeyPointSet.notifyObservers();
                } else {
                    this.props.context.mainKeyPoint = null;
                }
            }
        }
    }

    private _onPointerDown(evt: React.PointerEvent<SVGSVGElement>) {
        if (!this.props.context.activeKeyPoints) {
            this.props.context.activeKeyPoints = [];
        }

        this._select(evt.nativeEvent.ctrlKey);

        this.props.context.onActiveKeyPointChanged.notifyObservers();

        this._pointerIsDown = true;
        evt.currentTarget.setPointerCapture(evt.pointerId);
        this._sourcePointerX = evt.nativeEvent.offsetX;
        this._sourcePointerY = evt.nativeEvent.offsetY;

        const target = evt.nativeEvent.target as HTMLElement;
        if (target.tagName === "image") {
            this._controlMode = ControlMode.Key;
        } else if (target.classList.contains("left-tangent")) {
            this._controlMode = ControlMode.TangentLeft;
        } else if (target.classList.contains("right-tangent")) {
            this._controlMode = ControlMode.TangentRight;
        }

        evt.stopPropagation();
    }

    private _processTangentMove(evt: React.PointerEvent<SVGSVGElement>, vec: Vector2, storedLength: number) {
        vec.x += (evt.nativeEvent.offsetX - this._sourcePointerX) * this.props.scale;
        vec.y += (evt.nativeEvent.offsetY - this._sourcePointerY) * this.props.scale;

        let currentPosition = vec.clone();

        currentPosition.normalize();
        currentPosition.scaleInPlace(storedLength);

        console.log(">>")
        console.log(currentPosition.x, currentPosition.y);
        console.log(this.props.invertX(currentPosition.x), this.props.invertY(currentPosition.y));

        const value = this.props.invertY(currentPosition.y);
        const frame = this.props.invertX(currentPosition.x);

        return value / frame;
    }

    private _onPointerMove(evt: React.PointerEvent<SVGSVGElement>) {
        if (!this._pointerIsDown || this.state.selectedState !==  SelectionState.Selected) {
            return;
        }

        if (this._controlMode === ControlMode.TangentLeft) {
            this.props.curve.updateInTangentFromControlPoint(this.props.keyId, this._processTangentMove(evt, this._inVec, this._storedLengthin));
            this.forceUpdate();

        } else if (this._controlMode === ControlMode.TangentRight) {
            this.props.curve.updateOutTangentFromControlPoint(this.props.keyId, this._processTangentMove(evt, this._outVec, this._storedLengthOut));
            this.forceUpdate();

        } else if (this._controlMode === ControlMode.Key) {

            let newX = this.state.x + (evt.nativeEvent.offsetX - this._sourcePointerX) * this.props.scale;
            let newY = this.state.y + (evt.nativeEvent.offsetY - this._sourcePointerY) * this.props.scale;
            let previousX = this.props.getPreviousX();
            let nextX = this.props.getNextX();


            if (previousX !== null) {
                newX = Math.max(previousX, newX);
            }

            if (nextX !== null) {
                newX = Math.min(nextX, newX);
            }

            if (this.props.keyId !== 0) {
                let frame = this.props.invertX(newX);
                this.props.onFrameValueChanged(frame);
                this.props.context.onFrameSet.notifyObservers(frame);

                if (newX !== this.state.x) {
                    this.props.context.onActiveKeyFrameChanged.notifyObservers(newX);
                }
            } else {
                newX = this.state.x;
            }

            let value = this.props.invertY(newY);
            this.props.onKeyValueChanged(value);
            this.props.context.onValueSet.notifyObservers(value);
                
            this.setState({x: newX, y: newY});

            if (this.props.context.activeKeyPoints!.length > 1) {
                setTimeout(() => {
                    if (this.props.context.mainKeyPoint) {
                        this.props.context.onMainKeyPointMoved.notifyObservers();
                    }
                });
            }
        }

        this._sourcePointerX = evt.nativeEvent.offsetX;
        this._sourcePointerY = evt.nativeEvent.offsetY;
        evt.stopPropagation();
    }

    private _onPointerUp(evt: React.PointerEvent<SVGSVGElement>) {
        this._pointerIsDown = false;
        evt.currentTarget.releasePointerCapture(evt.pointerId);

        evt.stopPropagation();

        this._controlMode = ControlMode.None;
    }

    public render() {
        const svgImageIcon = this.state.selectedState === SelectionState.Selected ? keySelected : (this.state.selectedState === SelectionState.Siblings ? keyActive : keyInactive);

        if (!this._outVec) {
            const keys = this.props.curve.keys;
            const prevFrame = this.props.keyId > 0 ? keys[this.props.keyId - 1].frame : 0;
            const currentFrame = keys[this.props.keyId].frame;
            const nextFrame = this.props.keyId < keys.length - 1 ? keys[this.props.keyId + 1].frame : 0;
    
            let inFrameLength = (currentFrame - prevFrame) / 3;
            let outFrameLength = (nextFrame - currentFrame) / 3;
    
            const inControlPointValue = this.props.curve.getInControlPoint(this.props.keyId, inFrameLength);
            const outControlPointValue = this.props.curve.getOutControlPoint(this.props.keyId, outFrameLength);
            
            this._inVec = new Vector2(this.props.convertX(inFrameLength), this.props.convertY(inControlPointValue));
            this._outVec = new Vector2(this.props.convertX(outFrameLength), this.props.convertY(outControlPointValue));
            this._storedLengthin = this._inVec.length();
            this._storedLengthOut = this._outVec.length();
        }

        this._inVec.normalize();
        this._inVec.scaleInPlace(100 * this.props.scale);

        this._outVec.normalize();
        this._outVec.scaleInPlace(100 * this.props.scale);

        return (
            <svg
                ref={this._svgHost}
                onPointerDown={evt => this._onPointerDown(evt)}
                onPointerMove={evt => this._onPointerMove(evt)}
                onPointerUp={evt => this._onPointerUp(evt)}
                x={this.state.x}
                y={this.state.y}
                style={{ cursor: "pointer", overflow: "auto" }}
        >
            <image
                x={`-${8 * this.props.scale}`}
                y={`-${8 * this.props.scale}`}
                width={`${16 * this.props.scale}`}
                height={`${16 * this.props.scale}`}
                ref={this._keyPointSVG}
                href={svgImageIcon}                
            />
            {
                this.state.selectedState === SelectionState.Selected && 
                <g>
                    {/* {
                        inControlPointValue !== 0 &&
                        <>
                            <line
                                x1={0}
                                y1={0}
                                x2={`${inVec.x}px`}
                                y2={`${inVec.y}px`}
                                style={{
                                    stroke: "#F9BF00",
                                    strokeWidth: `${1 * this.props.scale}`
                                }}>
                            </line>
                            <circle
                                className="left-tangent"
                                cx={`${inVec.x}px`}
                                cy={`${inVec.y}px`}
                                r={`${4 * this.props.scale}`}
                                style={{
                                    fill: "#F9BF00",
                                }}>
                            </circle>
                        </>
                    } */}
                    {
                        <>
                            <line
                                x1={0}
                                y1={0}
                                x2={`${this._outVec.x}px`}
                                y2={`${this._outVec.y}px`}
                                style={{
                                    stroke: "#F9BF00",
                                    strokeWidth: `${1 * this.props.scale}`
                                }}>
                            </line>                        
                            <circle
                                className="right-tangent"
                                cx={`${this._outVec.x}px`}
                                cy={`${this._outVec.y}px`}
                                r={`${4 * this.props.scale}`}
                                style={{
                                    fill: "#F9BF00",
                                }}>
                            </circle>
                        </>
                    }
                </g>
            }
        </svg>
        );
    }
}