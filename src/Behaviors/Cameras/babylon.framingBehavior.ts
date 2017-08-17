module BABYLON {
    export class FramingBehavior implements Behavior<ArcRotateCamera> {
        public get name(): string {
            return "Framing";
        }

        private _mode = FramingBehavior.IgnoreBoundsSizeMode;
        private _radiusOffset = 0;
        private _elevation = 0.3;
        private _positionY = 0;
        private _defaultElevation = 0.3;
        private _elevationReturnTime = 1500;
        private _elevationReturnWaitTime = 1000;
        private _zoomStopsAnimation = false;
		private _framingTime = 1500;
		
		/**
		 * The easing function used by animations
		 */
		public static EasingFunction = new ExponentialEase();
		
		/**
		 * The easing mode used by animations
		 */
		public static EasingMode = EasingFunction.EASINGMODE_EASEINOUT;   		

        /**
		 * Sets the current mode used by the behavior
		 */
		public set mode(mode: number) {
			this._mode = mode;
		}

		/**
		 * Gets current mode used by the behavior.
		 */
		public get mode(): number {
			return this._mode;
        }
        
	    /**
		 * Sets the radius of the camera relative to the target's bounding box.
		 */
		public set radiusOffset(radius: number) {
			this._radiusOffset = radius;
		}

		/**
		 * Gets the radius of the camera relative to the target's bounding box.
		 */
		public get radiusOffset(): number {
			return this._radiusOffset;
		}

		/**
		 * Sets the elevation of the camera from the target, in radians.
		 */
		public set elevation(elevation: number) {
			this._elevation = elevation;
		}

		/**
		 * Gets the elevation of the camera from the target, in radians.
		 */
		public get elevation(): number {
			return this._elevation;
		}

		/**
		 * Sets the Y offset of the primary model from the camera's focus.
		 */
		public set positionY(positionY: number) {
			this._positionY = positionY;
		}

		/**
		 * Gets the Y offset of the primary model from the camera's focus.
		 */
		public get positionY(): number {
			return this._positionY;
		}

		/**
		* Sets the angle above/below the horizontal plane to return to when the return to default elevation idle
		* behaviour is triggered, in radians.
		*/
		public set defaultElevation(elevation: number) {
			this._defaultElevation = elevation;
		}

		/**
		* Gets the angle above/below the horizontal plane to return to when the return to default elevation idle
		* behaviour is triggered, in radians.
		*/
		public get defaultElevation() {
			return this._defaultElevation;
		}

		/**
		 * Sets the time (in milliseconds) taken to return to the default beta position.
		 * Negative value indicates camera should not return to default.
		 */
		public set elevationReturnTime(speed: number) {
			this._elevationReturnTime = speed;
		}

		/**
		 * Gets the time (in milliseconds) taken to return to the default beta position.
		 * Negative value indicates camera should not return to default.
		 */
		public get elevationReturnTime(): number {
			return this._elevationReturnTime;
		}

		/**
		 * Sets the delay (in milliseconds) taken before the camera returns to the default beta position.
		 */
		public set elevationReturnWaitTime(time: number) {
			this._elevationReturnWaitTime = time;
		}

		/**
		 * Gets the delay (in milliseconds) taken before the camera returns to the default beta position.
		 */
		public get elevationReturnWaitTime(): number {
			return this._elevationReturnWaitTime;
		}

		/**
		* Sets the flag that indicates if user zooming should stop model animation.
		*/
		public set zoomStopsAnimation(flag: boolean) {
			this._zoomStopsAnimation = flag;
		}

		/**
		* Gets the flag that indicates if user zooming should stop model animation.
		*/
		public get zoomStopsAnimation(): boolean {
			return this._zoomStopsAnimation;
        }       
        	
		/**
		 * Sets the transition time when framing the model, in milliseconds
		*/
		public set framingTime(time: number) {
			this._framingTime = time;
		}

        /**
         * Gets the transition time when framing the model, in milliseconds
        */
        public get framingTime() {
            return this._framingTime;
		}        
        
        // Default behavior functions
        private _onPrePointerObservableObserver: Observer<PointerInfoPre>;
		private _onAfterCheckInputsObserver: Observer<Camera>;
		private _onMeshTargetChangedObserver: Observer<AbstractMesh>;
        private _attachedCamera: ArcRotateCamera;
        private _isPointerDown = false;
        private _lastFrameTime: number = null;
        private _lastInteractionTime = -Infinity;

        public attach(camera: ArcRotateCamera): void {
            this._attachedCamera = camera;
            let scene = this._attachedCamera.getScene();

            this._onPrePointerObservableObserver = scene.onPrePointerObservable.add((pointerInfoPre) => {
                if (pointerInfoPre.type === PointerEventTypes.POINTERDOWN) {
                    this._isPointerDown = true;
                    return
                }

                if (pointerInfoPre.type === PointerEventTypes.POINTERUP) {
                    this._isPointerDown = false;
                }
			});
			
			this._onMeshTargetChangedObserver = camera.onMeshTargetChangedObservable.add((mesh) => {
				if (mesh) {
					this.zoomOnMesh(mesh);
				}
			});

            this._onAfterCheckInputsObserver = camera.onAfterCheckInputsObservable.add(() => {      
                // Stop the animation if there is user interaction and the animation should stop for this interaction
                this._applyUserInteraction();
       
                // Maintain the camera above the ground. If the user pulls the camera beneath the ground plane, lift it
                // back to the default position after a given timeout
                this._maintainCameraAboveGround();                
            });
        }
             
        public detach(camera: ArcRotateCamera): void {
            let scene = this._attachedCamera.getScene();
            
            scene.onPrePointerObservable.remove(this._onPrePointerObservableObserver);
			camera.onAfterCheckInputsObservable.remove(this._onAfterCheckInputsObserver);
			camera.onMeshTargetChangedObservable.remove(this._onMeshTargetChangedObserver);
        }

        // Framing control
        private _animatables = new Array<Animatable>();
        private _betaIsAnimating = false;
		private _betaTransition: Animation;
		private _radiusTransition: Animation;
		private _vectorTransition: Animation;
		private _lastFrameRadius = 0;
		
		/**
		 * Targets the given mesh and updates zoom level accordingly.
		 * @param mesh  The mesh to target.
		 * @param radius Optional. If a cached radius position already exists, overrides default.
		 * @param applyToLowerLimit Optional. Indicates if the calculated target radius should be applied to the
		 *		camera's lower radius limit too.
		 * @param framingPositionY Position on mesh to center camera focus where 0 corresponds bottom of its bounding box and 1, the top
		 * @param focusOnOriginXZ Determines if the camera should focus on 0 in the X and Z axis instead of the mesh
		 */
		public zoomOnMesh(mesh: AbstractMesh, radius?: number, applyToLowerLimit: boolean = false, framingPositionY?: number, focusOnOriginXZ: boolean = true): void {
			if (framingPositionY == null) {
				framingPositionY = this._positionY;
			}

			// sets the radius and lower radius bounds
			if (radius == null) {
				// Small delta ensures camera is not always at lower zoom limit.
				let delta = 0.1;
				if (this._mode === FramingBehavior.FitFrustumSidesMode) {
					let position = this._calculateLowerRadiusFromModelBoundingSphere(mesh, this.radiusOffset);
					this._attachedCamera.lowerRadiusLimit = position - delta;
					radius = position;
				} else if (this._mode === FramingBehavior.IgnoreBoundsSizeMode) {
					radius = this._calculateLowerRadiusFromModelBoundingSphere(mesh, this.radiusOffset);
				}
			}

			let zoomTarget: BABYLON.Vector3;
			let zoomTargetY: number;

			mesh.computeWorldMatrix(true);
			let modelWorldPosition = new BABYLON.Vector3(0, 0, 0);
			let modelWorldScale = new BABYLON.Vector3(0, 0, 0);

			mesh.getWorldMatrix().decompose(modelWorldScale, new BABYLON.Quaternion(), modelWorldPosition);

			//find target by interpolating from bottom of bounding box in world-space to top via framingPositionY
			let bottom = modelWorldPosition.y + mesh.getBoundingInfo().minimum.y;
			let top = modelWorldPosition.y + mesh.getBoundingInfo().maximum.y;
			zoomTargetY = bottom + (top - bottom) * framingPositionY;

			if (applyToLowerLimit) {
				this._attachedCamera.lowerRadiusLimit = radius;
			}

			if (!this._radiusTransition) {
				FramingBehavior.EasingFunction.setEasingMode(FramingBehavior.EasingMode);
				this._radiusTransition = Animation.CreateAnimation("radius", Animation.ANIMATIONTYPE_FLOAT, 60, FramingBehavior.EasingFunction);
			}

			// transition to new radius
			this._animatables.push(Animation.TransitionTo("radius", radius, this._attachedCamera, this._attachedCamera.getScene(), 
									60, this._radiusTransition, this._framingTime));

			if (focusOnOriginXZ) {	
				zoomTarget = new BABYLON.Vector3(0, zoomTargetY, 0);
			} else {
				zoomTarget = new BABYLON.Vector3(modelWorldPosition.x, zoomTargetY, modelWorldPosition.z);
			}

			// if (!this._vectorTransition) {
			// 	FramingBehavior.EasingFunction.setEasingMode(FramingBehavior.EasingMode);
			// 	this._vectorTransition = Animation.CreateAnimation("target", Animation.ANIMATIONTYPE_VECTOR3, 60, FramingBehavior.EasingFunction);
			// }			

			// this._animatables.push(Animation.TransitionTo("target", zoomTarget, this._attachedCamera, this._attachedCamera.getScene(), 
			// 						60, this._vectorTransition, this._framingTime));
		}	
		
		/**
		 * Calculates the lowest radius for the camera based on the bounding box of the mesh.
		 * @param mesh The mesh on which to base the calculation. mesh boundingInfo used to estimate necessary
		 *			  frustum width.
		 * @param framingRadius An additional factor to add to the return camera radius.
		 * @return The minimum distance from the primary mesh's center point at which the camera must be kept in order
		 *		 to fully enclose the mesh in the viewing frustum.
		 */
		protected _calculateLowerRadiusFromModelBoundingSphere(mesh: AbstractMesh, framingRadius: number): number {
            let boxVectorGlobalDiagonal = mesh.getBoundingInfo().diagonalLength;
			let frustumSlope: BABYLON.Vector2 = this._getFrustumSlope();

			// Formula for setting distance
			// (Good explanation: http://stackoverflow.com/questions/2866350/move-camera-to-fit-3d-scene)
			let radiusWithoutFraming = boxVectorGlobalDiagonal * 0.5;

			// Horizon distance
			let radius = radiusWithoutFraming * framingRadius;
			let distanceForHorizontalFrustum = radius * Math.sqrt(1.0 + 1.0 / (frustumSlope.x * frustumSlope.x));
			let distanceForVerticalFrustum = radius * Math.sqrt(1.0 + 1.0 / (frustumSlope.y * frustumSlope.y));
			let distance = Math.max(distanceForHorizontalFrustum, distanceForVerticalFrustum);
			let camera = this._attachedCamera;

			if (camera.lowerRadiusLimit && this._mode === FramingBehavior.IgnoreBoundsSizeMode) {
				// Don't exceed the requested limit
				distance = distance < camera.lowerRadiusLimit ? camera.lowerRadiusLimit : distance;
			}

			// Don't exceed the upper radius limit
			if (camera.upperRadiusLimit) {
				distance = distance > camera.upperRadiusLimit ? camera.upperRadiusLimit : distance;
			}

			return distance;
		}		

		/**
		 * Keeps the camera above the ground plane. If the user pulls the camera below the ground plane, the camera
		 * is automatically returned to its default position (expected to be above ground plane). 
		 */
		private _maintainCameraAboveGround(): void {
			let timeSinceInteraction = Tools.Now - this._lastInteractionTime;
			let defaultBeta = Math.PI * 0.5 - this._defaultElevation;
			let limitBeta = Math.PI * 0.5;
            
            // Bring the camera back up if below the ground plane
			if (!this._betaIsAnimating && this._attachedCamera.beta > limitBeta && timeSinceInteraction >= this._elevationReturnWaitTime) {
                this._betaIsAnimating = true;
                
				//Transition to new position
                this.stopAllAnimations();
                
                if (!this._betaTransition) {
                    FramingBehavior.EasingFunction.setEasingMode(FramingBehavior.EasingMode);
                    this._betaTransition = Animation.CreateAnimation("beta", Animation.ANIMATIONTYPE_FLOAT, 60, FramingBehavior.EasingFunction);
                }

				this._animatables.push(Animation.TransitionTo("beta", defaultBeta, this._attachedCamera, this._attachedCamera.getScene(), 60,
                    this._betaTransition, this._elevationReturnTime, 
                    () => {
						this._clearAnimationLocks();
						this.stopAllAnimations();
					}));
			}
		}        

		/**
		 * Returns the frustum slope based on the canvas ratio and camera FOV
		 * @returns The frustum slope represented as a Vector2 with X and Y slopes
		 */
		private _getFrustumSlope(): Vector2 {
			// Calculate the viewport ratio
			// Aspect Ratio is Height/Width.
			let camera = this._attachedCamera;
			let engine = camera.getScene().getEngine();
			var aspectRatio = engine.getAspectRatio(camera);

			// Camera FOV is the vertical field of view (top-bottom) in radians.
			// Slope of the frustum top/bottom planes in view space, relative to the forward vector.
			var frustumSlopeY = Math.tan(camera.fov / 2);

			// Slope of the frustum left/right planes in view space, relative to the forward vector.
			// Provides the amount that one side (e.g. left) of the frustum gets wider for every unit
			// along the forward vector.
			var frustumSlopeX = frustumSlopeY / aspectRatio;

			return new Vector2(frustumSlopeX, frustumSlopeY);
		}		

		/**
		 * Returns true if user is scrolling. 
		 * @return true if user is scrolling.
		 */
		protected _userIsZooming(): boolean {
			return this._attachedCamera.inertialRadiusOffset !== 0;
		}        

		/**
		 * Indicates if default model animation (rotation) should stop for the current user interaction.
		 * 
		 * @return True if the model animation (rotation) should stop when given the current user interaction.
		 */
		protected _shouldAnimationStopForInteraction(): boolean {
			var zoomHasHitLimit = false;
			if (this._lastFrameRadius === this._attachedCamera.radius && this._attachedCamera.inertialRadiusOffset !== 0) {
				zoomHasHitLimit = true;
			}

			// Update the record of previous radius - works as an approx. indicator of hitting radius limits
			this._lastFrameRadius = this._attachedCamera.radius;
			return this._zoomStopsAnimation ? zoomHasHitLimit : this._userIsZooming();
		}        

		/**
		 * Removes all animation locks. Allows new animations to be added to any of the arcCamera properties.
		 */
		private _clearAnimationLocks(): void {
			this._betaIsAnimating = false;
		}		

		/**
		 *  Applies any current user interaction to the camera. Takes into account maximum alpha rotation.
		 */          
        private _applyUserInteraction(): void {
			if (this._userIsMoving() && !this._shouldAnimationStopForInteraction()) {
                this._lastInteractionTime = Tools.Now;
				this.stopAllAnimations();				
				this._clearAnimationLocks();
			}
        }                
        
		/**
		 * Stops and removes all animations that have been applied to the camera
		 */        
        public stopAllAnimations(): void {
			this._attachedCamera.animations = [];
			while (this._animatables.length) {
				this._animatables[0].onAnimationEnd = null;
				this._animatables[0].stop();
				this._animatables.shift();
			}
		}        

        // Tools
        private _userIsMoving(): boolean {
			return this._attachedCamera.inertialAlphaOffset !== 0 ||
				this._attachedCamera.inertialBetaOffset !== 0 ||
				this._attachedCamera.inertialRadiusOffset !== 0 ||
				this._attachedCamera.inertialPanningX !== 0 ||
				this._attachedCamera.inertialPanningY !== 0 ||
				this._isPointerDown;
		}

        // Statics

        /**
         * The camera can move all the way towards the model.
         */
        public static IgnoreBoundsSizeMode = 0;

        /**
         * The camera is not allowed to zoom closer to the model than the point at which the adjusted bounding sphere touches the frustum sides
         */
        public static FitFrustumSidesMode = 0;
    }
}